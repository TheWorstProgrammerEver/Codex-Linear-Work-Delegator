import { createInitialState } from "../state/steward-state.js"
import { runSteward } from "./runner.js"
import type { AppServer } from "../app-server/client.js"
import type { AuditRecord } from "../audit/audit-log.js"
import type { RateLimitsResponse } from "../app-server/rate-limits.js"
import type { BlockedWorkEvidence } from "../evidence/blocked-work.js"
import type { RuntimeConfig } from "./config.js"
import type { StateStore, StewardState } from "../state/steward-state.js"

const NOW = new Date("2030-01-01T15:00:00.000Z")

export async function runSyntheticCheck(config: RuntimeConfig): Promise<void> {
  const syntheticConfig = { ...config, mode: "consume" as const, policyApproved: true }
  const stateStore = new SyntheticStateStore(createInitialState(config.policy.sha256))
  const appServer = new SyntheticAppServer()
  const auditRecords: AuditRecord[] = []
  const result = await runSteward(syntheticConfig, {
    appServer,
    stateStore,
    auditLog: { append: (record) => auditRecords.push(record) },
    clock: {
      check: () => ({
        stable: true,
        observation: {
          bootId: "synthetic-boot",
          wallClockMs: NOW.getTime(),
          monotonicMs: 1_000
        }
      })
    },
    readEvidence: syntheticEvidence,
    killSwitchActive: () => false,
    now: () => NOW
  })
  if (
    result.result !== "nothing_to_reset"
    || appServer.consumeCalls !== 1
    || stateStore.state.pending !== null
    || auditRecords.at(-1)?.result !== "nothing_to_reset"
  ) throw new Error("synthetic-check-failed")
}

class SyntheticStateStore implements StateStore {
  state: StewardState

  constructor(state: StewardState) {
    this.state = state
  }

  read(): StewardState {
    return structuredClone(this.state)
  }

  write(state: StewardState): void {
    this.state = structuredClone(state)
  }
}

class SyntheticAppServer implements AppServer {
  consumeCalls = 0

  async readRateLimits(): Promise<RateLimitsResponse> {
    return {
      rateLimits: {
        limitId: "codex",
        rateLimitReachedType: "rate_limit_reached",
        spendControlReached: false,
        primary: {
          usedPercent: 100,
          resetsAt: Math.floor((NOW.getTime() + 9 * 3_600_000) / 1_000)
        },
        secondary: null
      },
      rateLimitsByLimitId: null,
      rateLimitResetCredits: { availableCount: 1, credits: null }
    }
  }

  async consumeReset(): Promise<"nothingToReset"> {
    this.consumeCalls += 1
    return "nothingToReset"
  }

  async close(): Promise<void> {}
}

const syntheticEvidence = (): BlockedWorkEvidence => ({
  schemaVersion: 1,
  observedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  validUntil: new Date(NOW.getTime() + 60_000).toISOString(),
  agentId: "daedalus",
  purpose: "work",
  classifier: "usageLimitExceeded",
  source: "codex-app-server-v2-event",
  limitId: "codex",
  work: {
    identifier: "RYA-999",
    state: "in_progress",
    eligible: true,
    blockedBy: []
  }
})
