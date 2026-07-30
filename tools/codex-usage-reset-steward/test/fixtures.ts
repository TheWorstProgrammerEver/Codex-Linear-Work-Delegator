import { loadPolicy } from "../src/policy/policy-config.js"
import type { RateLimitsResponse } from "../src/app-server/rate-limits.js"
import type { BlockedWorkEvidence } from "../src/evidence/blocked-work.js"
import type { RuntimeConfig } from "../src/runtime/config.js"

export const NOW = new Date("2026-07-30T15:00:00.000Z")

export const evidence = (
  overrides: Partial<BlockedWorkEvidence> = {}
): BlockedWorkEvidence => ({
  schemaVersion: 1,
  observedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  validUntil: new Date(NOW.getTime() + 14 * 60_000).toISOString(),
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
  },
  ...overrides
})

export const rateLimits = (
  overrides: Partial<RateLimitsResponse> = {}
): RateLimitsResponse => ({
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
  rateLimitResetCredits: {
    availableCount: 1,
    credits: null
  },
  ...overrides
})

export function runtimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const policyPath = new URL("../config/policy.default.json", import.meta.url).pathname
  return {
    mode: "consume",
    configuredOwner: "daedalus",
    policy: loadPolicy(policyPath),
    policyApproved: true,
    policyPath,
    stateFile: "/fixture/state.json",
    auditFile: "/fixture/audit.jsonl",
    evidenceFile: "/fixture/evidence.json",
    killSwitchFile: "/fixture/disabled",
    lockFile: "/fixture/steward.lock",
    codexBin: "codex",
    ...overrides
  }
}
