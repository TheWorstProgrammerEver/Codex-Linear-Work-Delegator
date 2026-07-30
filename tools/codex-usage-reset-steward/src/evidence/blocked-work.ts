import { readFileSync } from "node:fs"
import { isRecord } from "../policy/policy-config.js"

export interface BlockedWorkEvidence {
  schemaVersion: 1
  observedAt: string
  validUntil: string
  agentId: string
  purpose: "work" | "review"
  classifier: "usageLimitExceeded"
  source: "codex-app-server-v2-event"
  limitId: string
  work: {
    identifier: string
    state: "in_progress" | "reviewing"
    eligible: true
    blockedBy: []
  }
}

export function readBlockedWorkEvidence(path: string): BlockedWorkEvidence | null {
  try {
    return parseBlockedWorkEvidence(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return null
  }
}

export function parseBlockedWorkEvidence(value: unknown): BlockedWorkEvidence {
  if (!isRecord(value) || !isRecord(value.work)) throw new Error("evidence-invalid")
  const topKeys = new Set([
    "schemaVersion", "observedAt", "validUntil", "agentId", "purpose",
    "classifier", "source", "limitId", "work"
  ])
  const workKeys = new Set(["identifier", "state", "eligible", "blockedBy"])
  if (
    Object.keys(value).some((key) => !topKeys.has(key))
    || Object.keys(value.work).some((key) => !workKeys.has(key))
    || value.schemaVersion !== 1
    || !isIsoDate(value.observedAt)
    || !isIsoDate(value.validUntil)
    || typeof value.agentId !== "string"
    || !["work", "review"].includes(String(value.purpose))
    || value.classifier !== "usageLimitExceeded"
    || value.source !== "codex-app-server-v2-event"
    || typeof value.limitId !== "string"
    || typeof value.work.identifier !== "string"
    || !/^[A-Z][A-Z0-9]+-\d+$/.test(value.work.identifier)
    || !["in_progress", "reviewing"].includes(String(value.work.state))
    || value.work.eligible !== true
    || !Array.isArray(value.work.blockedBy)
    || value.work.blockedBy.length !== 0
  ) throw new Error("evidence-invalid")
  return value as unknown as BlockedWorkEvidence
}

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
