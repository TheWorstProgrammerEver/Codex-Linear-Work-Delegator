import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { SOURCE_POLICY_SHA256 } from "./source-policy.js"

export interface PolicyConfig {
  schemaVersion: 1
  policyVersion: string
  sourceDefaultMode: "dry-run"
  designatedOwner: string
  allowedEvidenceAgents: string[]
  limitId: string
  evidenceMaxAgeMinutes: number
  minimumNaturalResetDelayHours: number
  unattendedWindow: {
    startHour: number
    endHour: number
    timeZone: string
  }
  minimumCreditValidityMinutes: number
  minimumConsumptionIntervalHours: number
  maximumPendingAgeMinutes: number
  maximumClockSkewSeconds: number
}

export interface LoadedPolicy {
  config: PolicyConfig
  sha256: string
}

export function loadPolicy(path: string): LoadedPolicy {
  const bytes = readFileSync(path)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (sha256 !== SOURCE_POLICY_SHA256) throw new Error("policy-digest-mismatch")
  return { config: parsePolicy(JSON.parse(bytes.toString("utf8"))), sha256 }
}

export function parsePolicy(value: unknown): PolicyConfig {
  if (!isRecord(value)) throw new Error("policy-invalid")
  const allowedKeys = new Set([
    "schemaVersion", "policyVersion", "sourceDefaultMode", "designatedOwner",
    "allowedEvidenceAgents", "limitId", "evidenceMaxAgeMinutes",
    "minimumNaturalResetDelayHours", "unattendedWindow",
    "minimumCreditValidityMinutes", "minimumConsumptionIntervalHours",
    "maximumPendingAgeMinutes", "maximumClockSkewSeconds"
  ])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new Error("policy-unknown-field")
  if (
    value.schemaVersion !== 1
    || typeof value.policyVersion !== "string"
    || value.sourceDefaultMode !== "dry-run"
    || typeof value.designatedOwner !== "string"
    || !isStringArray(value.allowedEvidenceAgents)
    || typeof value.limitId !== "string"
    || !isPositiveInteger(value.evidenceMaxAgeMinutes)
    || !isPositiveInteger(value.minimumNaturalResetDelayHours)
    || !isPositiveInteger(value.minimumCreditValidityMinutes)
    || !isPositiveInteger(value.minimumConsumptionIntervalHours)
    || !isPositiveInteger(value.maximumPendingAgeMinutes)
    || !isPositiveInteger(value.maximumClockSkewSeconds)
    || !isUnattendedWindow(value.unattendedWindow)
  ) throw new Error("policy-invalid")

  return value as unknown as PolicyConfig
}

function isUnattendedWindow(value: unknown): value is PolicyConfig["unattendedWindow"] {
  if (!isRecord(value)) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timeZone as string }).format()
  } catch {
    return false
  }
  return (
    Object.keys(value).every((key) => ["startHour", "endHour", "timeZone"].includes(key))
    && Number.isInteger(value.startHour) && Number(value.startHour) >= 0 && Number(value.startHour) <= 23
    && Number.isInteger(value.endHour) && Number(value.endHour) >= 0 && Number(value.endHour) <= 23
    && value.startHour !== value.endHour
    && typeof value.timeZone === "string"
  )
}

const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0
  && value.every((item) => typeof item === "string" && item.length > 0)

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
