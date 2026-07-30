import { isRecord } from "../policy/policy-config.js"

export interface RateLimitWindow {
  usedPercent: number
  resetsAt: number | null
}

export interface RateLimitSnapshot {
  limitId: string | null
  rateLimitReachedType:
    | "rate_limit_reached"
    | "workspace_owner_credits_depleted"
    | "workspace_member_credits_depleted"
    | "workspace_owner_usage_limit_reached"
    | "workspace_member_usage_limit_reached"
    | null
  spendControlReached: boolean | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
}

export interface ResetCredit {
  id: string
  expiresAt: number | null
  resetType: "codexRateLimits" | "unknown"
  status: "available" | "redeeming" | "redeemed" | "unknown"
}

export interface RateLimitsResponse {
  rateLimits: RateLimitSnapshot
  rateLimitsByLimitId: Record<string, RateLimitSnapshot> | null
  rateLimitResetCredits: {
    availableCount: number
    credits: ResetCredit[] | null
  } | null
}

const reachedTypes = new Set([
  "rate_limit_reached",
  "workspace_owner_credits_depleted",
  "workspace_member_credits_depleted",
  "workspace_owner_usage_limit_reached",
  "workspace_member_usage_limit_reached"
])
const creditStatuses = new Set(["available", "redeeming", "redeemed", "unknown"])
const resetTypes = new Set(["codexRateLimits", "unknown"])

export function parseRateLimitsResponse(value: unknown): RateLimitsResponse {
  if (!isRecord(value)) throw new Error("rate-limits-invalid")
  const rateLimits = parseSnapshot(value.rateLimits)
  const byLimitId = value.rateLimitsByLimitId === null || value.rateLimitsByLimitId === undefined
    ? null
    : parseSnapshotMap(value.rateLimitsByLimitId)
  const credits = value.rateLimitResetCredits === null || value.rateLimitResetCredits === undefined
    ? null
    : parseCreditSummary(value.rateLimitResetCredits)
  return { rateLimits, rateLimitsByLimitId: byLimitId, rateLimitResetCredits: credits }
}

function parseSnapshotMap(value: unknown): Record<string, RateLimitSnapshot> {
  if (!isRecord(value)) throw new Error("rate-limits-invalid")
  return Object.fromEntries(Object.entries(value).map(([key, snapshot]) => [key, parseSnapshot(snapshot)]))
}

function parseSnapshot(value: unknown): RateLimitSnapshot {
  if (!isRecord(value)) throw new Error("rate-limits-invalid")
  const reached = value.rateLimitReachedType
  if (reached !== null && reached !== undefined && !reachedTypes.has(String(reached))) {
    throw new Error("rate-limits-schema-drift")
  }
  if (value.limitId !== null && value.limitId !== undefined && typeof value.limitId !== "string") {
    throw new Error("rate-limits-invalid")
  }
  if (
    value.spendControlReached !== null
    && value.spendControlReached !== undefined
    && typeof value.spendControlReached !== "boolean"
  ) throw new Error("rate-limits-invalid")
  return {
    limitId: value.limitId === undefined ? null : value.limitId as string | null,
    rateLimitReachedType: reached === undefined ? null : reached as RateLimitSnapshot["rateLimitReachedType"],
    spendControlReached: value.spendControlReached === undefined ? null : value.spendControlReached as boolean | null,
    primary: parseOptionalWindow(value.primary),
    secondary: parseOptionalWindow(value.secondary)
  }
}

function parseOptionalWindow(value: unknown): RateLimitWindow | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || !Number.isSafeInteger(value.usedPercent) || Number(value.usedPercent) < 0) {
    throw new Error("rate-limits-invalid")
  }
  if (value.resetsAt !== null && value.resetsAt !== undefined && !Number.isSafeInteger(value.resetsAt)) {
    throw new Error("rate-limits-invalid")
  }
  return {
    usedPercent: Number(value.usedPercent),
    resetsAt: value.resetsAt === undefined ? null : value.resetsAt as number | null
  }
}

function parseCreditSummary(value: unknown): RateLimitsResponse["rateLimitResetCredits"] {
  if (!isRecord(value) || !Number.isSafeInteger(value.availableCount) || Number(value.availableCount) < 0) {
    throw new Error("rate-limits-invalid")
  }
  if (value.credits === null || value.credits === undefined) {
    return { availableCount: Number(value.availableCount), credits: null }
  }
  if (!Array.isArray(value.credits)) throw new Error("rate-limits-invalid")
  return { availableCount: Number(value.availableCount), credits: value.credits.map(parseCredit) }
}

function parseCredit(value: unknown): ResetCredit {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || value.id.length === 0
    || !creditStatuses.has(String(value.status))
    || !resetTypes.has(String(value.resetType))
    || (value.expiresAt !== null && value.expiresAt !== undefined && !Number.isSafeInteger(value.expiresAt))
  ) throw new Error("rate-limits-invalid")
  return {
    id: value.id,
    expiresAt: value.expiresAt === undefined ? null : value.expiresAt as number | null,
    resetType: value.resetType as ResetCredit["resetType"],
    status: value.status as ResetCredit["status"]
  }
}
