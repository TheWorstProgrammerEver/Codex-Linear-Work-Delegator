import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import type { Interface } from "node:readline"

export interface ThreadErrorReader {
  hasUsageLimitExceeded(threadId: string): Promise<boolean>
  close(): Promise<void>
}

interface RpcResponse {
  id?: number
  result?: unknown
  error?: unknown
}

export class CodexThreadErrorReader implements ThreadErrorReader {
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

  async hasUsageLimitExceeded(threadId: string): Promise<boolean> {
    await this.#start()
    const response = await this.#request("thread/read", { threadId, includeTurns: true })
    return parseUsageLimitExceeded(response, threadId)
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

  async #start(): Promise<void> {
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
      clientInfo: { name: "codex-linear-work-delegator", version: "0.1.0" }
    })
    this.#notify("initialized", {})
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

export function parseUsageLimitExceeded(value: unknown, expectedThreadId: string): boolean {
  if (!isRecord(value) || !isRecord(value.thread)) return false
  if (value.thread.id !== expectedThreadId || !Array.isArray(value.thread.turns)) return false
  const latestTurn = value.thread.turns.at(-1)
  if (!isRecord(latestTurn) || latestTurn.status !== "failed" || !isRecord(latestTurn.error)) {
    return false
  }
  return latestTurn.error.codexErrorInfo === "usageLimitExceeded"
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
