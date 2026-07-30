import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { parseRateLimitsResponse } from "./rate-limits.js"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { Interface } from "node:readline"
import type { RateLimitsResponse } from "./rate-limits.js"
import type { ConsumeOutcome } from "../state/steward-state.js"

export interface AppServer {
  readRateLimits(): Promise<RateLimitsResponse>
  consumeReset(idempotencyKey: string): Promise<ConsumeOutcome>
  close(): Promise<void>
}

interface RpcResponse {
  id?: number
  result?: unknown
  error?: unknown
}

export class CodexAppServer implements AppServer {
  readonly #codexBin: string
  readonly #timeoutMs: number
  #child: ChildProcessWithoutNullStreams | null = null
  #lines: Interface | null = null
  #nextId = 1
  #pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  constructor(codexBin = "codex", timeoutMs = 15_000) {
    this.#codexBin = codexBin
    this.#timeoutMs = timeoutMs
  }

  async start(): Promise<void> {
    if (this.#child) return
    const child = spawn(this.#codexBin, ["app-server", "--listen", "stdio://"], {
      env: buildAppServerEnvironment(),
      stdio: ["pipe", "pipe", "pipe"]
    })
    child.stderr.resume()
    this.#child = child
    this.#lines = createInterface({ input: child.stdout })
    this.#lines.on("line", (line) => this.#handleLine(line))
    child.once("error", () => this.#rejectAll("app-server-start-failed"))
    child.once("close", () => this.#rejectAll("app-server-closed"))
    await this.#request("initialize", {
      clientInfo: { name: "codex-usage-reset-steward", version: "0.1.0" }
    })
    this.#notify("initialized", {})
  }

  async readRateLimits(): Promise<RateLimitsResponse> {
    await this.start()
    return parseRateLimitsResponse(await this.#request("account/rateLimits/read", null))
  }

  async consumeReset(idempotencyKey: string): Promise<ConsumeOutcome> {
    await this.start()
    const value = await this.#request(
      "account/rateLimitResetCredit/consume",
      { idempotencyKey }
    )
    if (
      typeof value !== "object"
      || value === null
      || !("outcome" in value)
      || !["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(String(value.outcome))
    ) throw new Error("consume-outcome-invalid")
    return value.outcome as ConsumeOutcome
  }

  async close(): Promise<void> {
    const child = this.#child
    if (!child) return
    this.#child = null
    this.#lines?.close()
    this.#lines = null
    child.stdin.end()
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }, 2_000)
      force.unref()
      child.once("close", () => {
        clearTimeout(force)
        resolve()
      })
    })
  }

  async #request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error("app-server-timeout"))
      }, this.#timeoutMs)
      this.#pending.set(id, { resolve, reject, timeout })
      try {
        this.#write({ id, method, params })
      } catch {
        clearTimeout(timeout)
        this.#pending.delete(id)
        reject(new Error("app-server-unavailable"))
      }
    })
  }

  #notify(method: string, params: unknown): void {
    this.#write({ method, params })
  }

  #write(value: unknown): void {
    if (!this.#child?.stdin.writable) throw new Error("app-server-unavailable")
    this.#child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  #handleLine(line: string): void {
    let response: RpcResponse
    try {
      response = JSON.parse(line) as RpcResponse
    } catch {
      this.#rejectAll("app-server-protocol-invalid")
      return
    }
    if (typeof response.id !== "number") return
    const pending = this.#pending.get(response.id)
    if (!pending) return
    this.#pending.delete(response.id)
    clearTimeout(pending.timeout)
    if (response.error !== undefined) pending.reject(new Error("app-server-request-failed"))
    else pending.resolve(response.result)
  }

  #rejectAll(code: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(code))
    }
    this.#pending.clear()
  }
}

const APP_SERVER_ENVIRONMENT_KEYS = [
  "CODEX_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "CODEX_HOME",
  "HOME",
  "OPENAI_API_KEY",
  "OPENAI_ORGANIZATION",
  "PATH",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME"
] as const

export const buildAppServerEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(APP_SERVER_ENVIRONMENT_KEYS.flatMap((key) => {
    const value = process.env[key]
    return value === undefined ? [] : [[key, value]]
  }))
