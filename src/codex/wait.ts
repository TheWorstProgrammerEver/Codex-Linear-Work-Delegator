import type { spawn } from "node:child_process"
import { clearCurrentState } from "../state.js"
import type { Config } from "../env/types.js"

type ChildProcess = ReturnType<typeof spawn>
type WaitResult = "exit" | "timeout"

export const waitForChildStart = (child: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    if (typeof child.pid === "number" && child.pid > 0) {
      resolve(child.pid)
      return
    }

    const cleanup = () => {
      child.off("spawn", onSpawn)
      child.off("error", onError)
      child.off("close", onClose)
    }
    const onSpawn = () => {
      cleanup()
      if (typeof child.pid === "number" && child.pid > 0) resolve(child.pid)
      else reject(new Error("Codex child spawned without a pid."))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`Codex child closed before spawning. code=${formatExitValue(code)} signal=${formatExitValue(signal)}`))
    }

    child.once("spawn", onSpawn)
    child.once("error", onError)
    child.once("close", onClose)
  })

export async function waitForChildOrTimeout(config: Config, pid: number, child: ChildProcess): Promise<void> {
  if (config.codexExecMode === "attached") {
    await waitForExit(config, pid, child)
    clearCurrentState(config, pid)
    console.log(`Codex child pid=${pid} exited.`)
    return
  }

  if (config.waitTimeoutMs === 0) {
    child.unref()
    return
  }

  if (await waitForExitOrTimeout(config, pid, config.waitTimeoutMs, child) === "exit") {
    clearCurrentState(config, pid)
    console.log(`Codex child pid=${pid} exited before wait timeout.`)
    return
  }

  child.unref()
  console.log(`Codex child pid=${pid} is still running after wait timeout; leaving state for next scheduler run.`)
}

const waitForExit = (config: Config, pid: number, child: ChildProcess): Promise<WaitResult> =>
  waitForExitOrTimeout(config, pid, null, child)

const waitForExitOrTimeout = (
  config: Config,
  pid: number,
  timeoutMs: number | null,
  child: ChildProcess
): Promise<WaitResult> =>
  new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve("exit")
      return
    }

    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      child.off("exit", onExit)
      child.off("close", onClose)
      child.off("error", onError)
    }
    const finish = (result: WaitResult) => {
      cleanup()
      resolve(result)
    }
    const onExit = () => finish("exit")
    const onClose = () => finish("exit")
    const onError = (error: Error) => {
      clearCurrentState(config, pid)
      cleanup()
      reject(error)
    }

    if (timeoutMs !== null) timeout = setTimeout(() => finish("timeout"), timeoutMs)
    child.once("exit", onExit)
    child.once("close", onClose)
    child.once("error", onError)
  })

const formatExitValue = (value: number | string | null): string =>
  value === null ? "null" : String(value)
