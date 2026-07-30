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

export class SystemClockSource implements ClockSource {
  check(previous: ClockObservation | null, maximumClockSkewSeconds: number): ClockCheck {
    const observation = {
      bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
      wallClockMs: Date.now(),
      monotonicMs: Math.round(process.uptime() * 1_000)
    }
    return {
      stable: evaluateClockStability(
        previous,
        observation,
        readSynchronizationStatus(),
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

function readSynchronizationStatus(): boolean {
  const result = spawnSync(
    "timedatectl",
    ["show", "--property=NTPSynchronized", "--value"],
    { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096 }
  )
  return result.status === 0 && result.signal === null && result.stdout.trim() === "yes"
}
