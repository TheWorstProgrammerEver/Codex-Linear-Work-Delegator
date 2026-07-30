import type { RateLimitSnapshot, RateLimitsResponse } from "../app-server/rate-limits.js"
import type { BlockedWorkEvidence } from "../evidence/blocked-work.js"
import type { PolicyConfig } from "./policy-config.js"

export type ReasonCode =
  | "clock_unstable"
  | "credit_details_inconsistent"
  | "evidence_agent_not_allowed"
  | "evidence_expired"
  | "evidence_future_dated"
  | "evidence_limit_mismatch"
  | "evidence_missing"
  | "frequency_limited"
  | "kill_switch_active"
  | "limit_bucket_missing"
  | "limit_not_exhausted"
  | "natural_reset_too_close"
  | "no_eligible_credit"
  | "not_ordinary_rate_limit"
  | "outside_unattended_window"
  | "owner_mismatch"
  | "pending_attempt_expired"
  | "pending_recovery_not_authorized"
  | "policy_digest_unapproved"
  | "spend_control_reached"

export interface PolicyInput {
  nowMs: number
  mode: "dry-run" | "consume"
  configuredOwner: string
  policyApproved: boolean
  killSwitchActive: boolean
  clockStable: boolean
  evidence: BlockedWorkEvidence | null
  rateLimits: RateLimitsResponse
  lastConsumedAt: string | null
}

export interface PolicyDecision {
  consume: boolean
  reasons: ReasonCode[]
  workReference: string | null
  creditAvailability: "available" | "none" | "unknown"
  exhaustedEligibleBucket: boolean
}

export function evaluatePolicy(policy: PolicyConfig, input: PolicyInput): PolicyDecision {
  const reasons: ReasonCode[] = []
  if (input.configuredOwner !== policy.designatedOwner) reasons.push("owner_mismatch")
  if (!input.policyApproved && input.mode === "consume") reasons.push("policy_digest_unapproved")
  if (input.killSwitchActive) reasons.push("kill_switch_active")
  if (!input.clockStable) reasons.push("clock_unstable")

  const evidence = input.evidence
  if (!evidence) reasons.push("evidence_missing")
  else {
    const observedAt = Date.parse(evidence.observedAt)
    const validUntil = Date.parse(evidence.validUntil)
    const maxAgeMs = policy.evidenceMaxAgeMinutes * 60_000
    if (observedAt > input.nowMs + policy.maximumClockSkewSeconds * 1_000) reasons.push("evidence_future_dated")
    if (input.nowMs - observedAt > maxAgeMs || validUntil < input.nowMs) reasons.push("evidence_expired")
    if (!policy.allowedEvidenceAgents.includes(evidence.agentId)) reasons.push("evidence_agent_not_allowed")
    if (evidence.limitId !== policy.limitId) reasons.push("evidence_limit_mismatch")
  }

  const bucket = selectBucket(input.rateLimits, policy.limitId)
  if (!bucket) reasons.push("limit_bucket_missing")
  const exhaustedWindows = bucket ? [bucket.primary, bucket.secondary].filter(isExhaustedWindow) : []
  const exhaustedEligibleBucket = exhaustedWindows.length > 0
  if (bucket?.spendControlReached === true) reasons.push("spend_control_reached")
  if (bucket && bucket.rateLimitReachedType !== "rate_limit_reached") reasons.push("not_ordinary_rate_limit")
  if (bucket && !exhaustedEligibleBucket) reasons.push("limit_not_exhausted")
  if (exhaustedEligibleBucket) {
    const naturalResetAt = Math.max(...exhaustedWindows.map((window) => Number(window?.resetsAt) * 1_000))
    if (naturalResetAt - input.nowMs < policy.minimumNaturalResetDelayHours * 3_600_000) {
      reasons.push("natural_reset_too_close")
    }
  }

  const credit = classifyCredit(input.rateLimits, policy, input.nowMs)
  if (credit === "none" || credit === "unknown") reasons.push("no_eligible_credit")
  if (credit === "inconsistent") reasons.push("credit_details_inconsistent")

  if (!insideUnattendedWindow(input.nowMs, policy) && input.mode === "consume") {
    reasons.push("outside_unattended_window")
  }
  if (input.lastConsumedAt) {
    const lastConsumedAt = Date.parse(input.lastConsumedAt)
    if (
      !Number.isFinite(lastConsumedAt)
      || input.nowMs - lastConsumedAt < policy.minimumConsumptionIntervalHours * 3_600_000
    ) reasons.push("frequency_limited")
  }

  return {
    consume: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    workReference: evidence?.work.identifier ?? null,
    creditAvailability: credit === "available" ? "available" : credit === "none" ? "none" : "unknown",
    exhaustedEligibleBucket
  }
}

const selectBucket = (response: RateLimitsResponse, limitId: string): RateLimitSnapshot | null => {
  if (response.rateLimitsByLimitId) return response.rateLimitsByLimitId[limitId] ?? null
  return response.rateLimits.limitId === limitId ? response.rateLimits : null
}

const isExhaustedWindow = (
  window: RateLimitSnapshot["primary"]
): window is NonNullable<RateLimitSnapshot["primary"]> =>
  window !== null && window.usedPercent >= 100 && window.resetsAt !== null

function classifyCredit(
  response: RateLimitsResponse,
  policy: PolicyConfig,
  nowMs: number
): "available" | "none" | "unknown" | "inconsistent" {
  const summary = response.rateLimitResetCredits
  if (!summary) return "unknown"
  if (summary.availableCount === 0) return "none"
  if (summary.credits === null) return "available"
  if (summary.credits.length === 0) return "inconsistent"
  const minimumExpiry = nowMs / 1_000 + policy.minimumCreditValidityMinutes * 60
  return summary.credits.some((credit) =>
    credit.status === "available"
    && credit.resetType === "codexRateLimits"
    && (credit.expiresAt === null || credit.expiresAt >= minimumExpiry)
  ) ? "available" : "none"
}

function insideUnattendedWindow(nowMs: number, policy: PolicyConfig): boolean {
  const hourText = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: policy.unattendedWindow.timeZone
  }).format(new Date(nowMs))
  const hour = Number(hourText)
  const { startHour, endHour } = policy.unattendedWindow
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour
}
