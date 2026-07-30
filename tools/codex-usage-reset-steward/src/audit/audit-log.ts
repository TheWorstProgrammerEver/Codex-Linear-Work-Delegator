import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync
} from "node:fs"
import { dirname } from "node:path"
import { preparePrivateDirectory, validateTrustedDirectory } from "../state/steward-state.js"
import type { ConsumeOutcome } from "../state/steward-state.js"
import type { PolicyDecision } from "../policy/evaluate.js"

export type AuditResult =
  | "already_redeemed"
  | "ambiguous_transport"
  | "dry_run"
  | "error"
  | "locked"
  | "no_credit"
  | "nothing_to_reset"
  | "policy_blocked"
  | "reset"

export interface AuditRecord {
  timestamp: string
  policyVersion: string
  policySha256: string
  codeVersion: string
  mode: "dry-run" | "consume"
  decision: "consume" | "do_not_consume"
  reasons: string[]
  workReference: string | null
  creditAvailability: "available" | "none" | "unknown"
  exhaustedEligibleBucket: boolean
  result: AuditResult
}

export function buildAuditRecord(input: {
  timestamp: string
  policyVersion: string
  policySha256: string
  codeVersion: string
  mode: "dry-run" | "consume"
  decision: PolicyDecision
  result: AuditResult
}): AuditRecord {
  return {
    timestamp: input.timestamp,
    policyVersion: input.policyVersion,
    policySha256: input.policySha256,
    codeVersion: input.codeVersion,
    mode: input.mode,
    decision: input.decision.consume ? "consume" : "do_not_consume",
    reasons: input.decision.reasons,
    workReference: input.decision.workReference,
    creditAvailability: input.decision.creditAvailability,
    exhaustedEligibleBucket: input.decision.exhaustedEligibleBucket,
    result: input.result
  }
}

export function outcomeToAuditResult(outcome: ConsumeOutcome): AuditResult {
  switch (outcome) {
    case "reset": return "reset"
    case "alreadyRedeemed": return "already_redeemed"
    case "nothingToReset": return "nothing_to_reset"
    case "noCredit": return "no_credit"
  }
}

export class AuditLog {
  readonly #path: string
  readonly #validateDirectory: (path: string) => void

  constructor(path: string, validateDirectory = validateTrustedDirectory) {
    this.#path = path
    this.#validateDirectory = validateDirectory
  }

  append(record: AuditRecord): void {
    const directory = dirname(this.#path)
    preparePrivateDirectory(directory, this.#validateDirectory)
    if (existsSync(this.#path)) {
      const stat = lstatSync(this.#path)
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.uid !== process.getuid?.()
        || (stat.mode & 0o077) !== 0
        || stat.nlink !== 1
      ) throw new Error("audit-file-untrusted")
    }
    const descriptor = openSync(
      this.#path,
      constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600
    )
    try {
      writeFileSync(descriptor, `${JSON.stringify(record)}\n`)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  }
}
