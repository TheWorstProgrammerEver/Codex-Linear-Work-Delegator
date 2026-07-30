import { createHash, randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"
import { readLinuxProcessIdentity } from "../process-identity.js"
import { clearCurrentState, isCurrentProcessLive, readCurrentState } from "../state.js"
import type { Config } from "../env/types.js"
import type { ProcessIdentityReader } from "../process-identity.js"
import type { CurrentState } from "../state.js"

const LOG_TAIL_SAMPLE_BYTES = 16 * 1024

export type ReviewTermination = "exited" | "signaled" | "process-missing" | "process-error"

export interface ReviewRunRecord {
  version: 1
  issueId: string
  identifier: string
  pid: number
  startedAt: string
  recordedAt: string
  termination: ReviewTermination
  classification: `${ReviewTermination}-${"with-evidence" | "without-evidence"}`
  exitCode: number | null
  signal: string | null
  logEvidence: {
    byteCount: number
    sampledTailBytes: number
    tailSha256: string | null
  }
}

interface TerminationDetails {
  termination: ReviewTermination
  exitCode: number | null
  signal: string | null
}

export function recoverExitedReviewState(
  config: Config,
  readIdentity: ProcessIdentityReader = readLinuxProcessIdentity
): CurrentState | null {
  const current = readCurrentState(config)
  if (!current || isCurrentProcessLive(current, readIdentity)) return current

  if (current.purpose !== "work") {
    writeReviewRunRecord(config, current, {
      termination: "process-missing",
      exitCode: null,
      signal: null
    })
  }
  clearCurrentState(config, current.pid)
  return null
}

export function writeReviewRunRecord(
  config: Config,
  state: CurrentState,
  termination: TerminationDetails
): ReviewRunRecord {
  const logEvidence = inspectLogEvidence(state.logFile)
  const evidence = logEvidence.byteCount > 0 ? "with-evidence" : "without-evidence"
  const record: ReviewRunRecord = {
    version: 1,
    issueId: state.issueId,
    identifier: state.identifier,
    pid: state.pid,
    startedAt: state.startedAt,
    recordedAt: new Date().toISOString(),
    termination: termination.termination,
    classification: `${termination.termination}-${evidence}`,
    exitCode: termination.exitCode,
    signal: termination.signal,
    logEvidence
  }

  writeRecordAtomically(reviewRunRecordPath(config, state.issueId), record)
  return record
}

export function readReviewRunRecord(config: Config, issueId: string): ReviewRunRecord | null {
  const file = reviewRunRecordPath(config, issueId)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, "utf8")) as ReviewRunRecord
}

function inspectLogEvidence(logFile: string): ReviewRunRecord["logEvidence"] {
  if (!existsSync(logFile)) return emptyLogEvidence()

  const fd = openSync(logFile, "r")
  try {
    const byteCount = fstatSync(fd).size
    if (byteCount === 0) return emptyLogEvidence()

    const sampledTailBytes = Math.min(byteCount, LOG_TAIL_SAMPLE_BYTES)
    const tail = Buffer.alloc(sampledTailBytes)
    readSync(fd, tail, 0, sampledTailBytes, byteCount - sampledTailBytes)
    return {
      byteCount,
      sampledTailBytes,
      tailSha256: createHash("sha256").update(tail).digest("hex")
    }
  } finally {
    closeSync(fd)
  }
}

const emptyLogEvidence = (): ReviewRunRecord["logEvidence"] => ({
  byteCount: 0,
  sampledTailBytes: 0,
  tailSha256: null
})

function writeRecordAtomically(file: string, record: ReviewRunRecord): void {
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`

  try {
    writeFileSync(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

const reviewRunRecordPath = (config: Config, issueId: string): string =>
  join(config.stateDir, "review-runs", `${createHash("sha256").update(issueId).digest("hex")}.json`)
