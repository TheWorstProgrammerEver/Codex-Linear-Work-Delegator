import { isRecord } from "../policy/policy-config.js"

export type ConsumeOutcome = "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit"

export interface PendingAttempt {
  phase: "prepared" | "dispatched" | "outcome_received"
  idempotencyKey: string
  preparedAt: string
  workReference: string
  outcome?: ConsumeOutcome
}

export interface ClockObservation {
  bootId: string
  wallClockMs: number
  monotonicMs: number
}

export interface StewardState {
  schemaVersion: 1
  policySha256: string
  lastConsumedAt: string | null
  clockObservation: ClockObservation | null
  pending: PendingAttempt | null
}

export function parseStewardState(value: unknown, expectedPolicySha256: string): StewardState {
  if (!isRecord(value)) throw new Error("state-invalid")
  const allowedKeys = new Set([
    "schemaVersion", "policySha256", "lastConsumedAt", "clockObservation", "pending"
  ])
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key))
    || value.schemaVersion !== 1
    || value.policySha256 !== expectedPolicySha256
    || (value.lastConsumedAt !== null && !isIsoDate(value.lastConsumedAt))
  ) throw new Error("state-invalid")
  const clockObservation = value.clockObservation === null
    ? null
    : parseClockObservation(value.clockObservation)
  const pending = value.pending === null ? null : parsePendingAttempt(value.pending)
  return { ...value, clockObservation, pending } as unknown as StewardState
}

function parsePendingAttempt(value: unknown): PendingAttempt {
  if (!isRecord(value)) throw new Error("state-invalid")
  const allowedKeys = new Set(["phase", "idempotencyKey", "preparedAt", "workReference", "outcome"])
  const phase = value.phase
  const outcome = value.outcome
  if (
    Object.keys(value).some((key) => !allowedKeys.has(key))
    || !["prepared", "dispatched", "outcome_received"].includes(String(phase))
    || typeof value.idempotencyKey !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey)
    || !isIsoDate(value.preparedAt)
    || typeof value.workReference !== "string"
    || !/^[A-Z][A-Z0-9]+-\d+$/.test(value.workReference)
    || (phase === "outcome_received" && !isConsumeOutcome(outcome))
    || (phase !== "outcome_received" && outcome !== undefined)
  ) throw new Error("state-invalid")
  return value as unknown as PendingAttempt
}

function parseClockObservation(value: unknown): ClockObservation {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !["bootId", "wallClockMs", "monotonicMs"].includes(key))
    || typeof value.bootId !== "string"
    || value.bootId.length === 0
    || !Number.isSafeInteger(value.wallClockMs)
    || !Number.isFinite(value.monotonicMs)
    || Number(value.monotonicMs) < 0
  ) throw new Error("state-invalid")
  return value as unknown as ClockObservation
}

const isConsumeOutcome = (value: unknown): value is ConsumeOutcome =>
  ["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(String(value))

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
