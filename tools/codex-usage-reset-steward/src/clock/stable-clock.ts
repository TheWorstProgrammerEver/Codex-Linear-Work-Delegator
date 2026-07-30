import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import type { ClockObservation } from "../state/steward-state.js"

export interface ClockCheck {
  stable: boolean
  observation: ClockObservation
}

export interface ClockSource {
  check(previous: ClockObservation | null, maximumClockSkewSeconds: number): ClockCheck
}

interface SystemClockDependencies {
  readBootId: () => string
  readMonotonicMs: () => number
  readWallClockMs: () => number
  readSynchronized: () => boolean
}

export class SystemClockSource implements ClockSource {
  readonly #dependencies: SystemClockDependencies

  constructor(dependencies: SystemClockDependencies = {
    readBootId: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    readMonotonicMs: readLinuxBootUptimeMs,
    readWallClockMs: Date.now,
    readSynchronized: readSynchronizationStatus
  }) {
    this.#dependencies = dependencies
  }

  check(previous: ClockObservation | null, maximumClockSkewSeconds: number): ClockCheck {
    const observation = {
      bootId: this.#dependencies.readBootId(),
      wallClockMs: this.#dependencies.readWallClockMs(),
      monotonicMs: this.#dependencies.readMonotonicMs()
    }
    return {
      stable: evaluateClockStability(
        previous,
        observation,
        this.#dependencies.readSynchronized(),
        maximumClockSkewSeconds
      ),
      observation
    }
  }
}

export function evaluateClockStability(
  previous: ClockObservation | null,
  observation: ClockObservation,
  synchronized: boolean,
  maximumClockSkewSeconds: number
): boolean {
    if (!synchronized) return false
    if (!previous || previous.bootId !== observation.bootId) return true
    const wallDelta = observation.wallClockMs - previous.wallClockMs
    const monotonicDelta = observation.monotonicMs - previous.monotonicMs
    const skew = Math.abs(wallDelta - monotonicDelta)
  return wallDelta >= 0 && monotonicDelta >= 0 && skew <= maximumClockSkewSeconds * 1_000
}

export function parseLinuxBootUptimeMs(value: string): number {
  const secondsText = value.trim().split(/\s+/, 1)[0]
  const seconds = Number(secondsText)
  const milliseconds = Math.round(seconds * 1_000)
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("clock-monotonic-source-invalid")
  }
  return milliseconds
}

function readLinuxBootUptimeMs(): number {
  return parseLinuxBootUptimeMs(readFileSync("/proc/uptime", "utf8"))
}

function readSynchronizationStatus(): boolean {
  const result = spawnSync(
    "timedatectl",
    ["show", "--property=NTPSynchronized", "--value"],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096 }
  )
  return result.status === 0 && result.signal === null && result.stdout.trim() === "yes"
}
