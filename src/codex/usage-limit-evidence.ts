import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"
import { CodexThreadErrorReader } from "./thread-error-reader.js"
import { getUnresolvedBlockers } from "../linear/dependencies.js"
import { matchesLabel } from "../linear/labels.js"
import { LinearClient } from "../linear.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"
import type { ThreadErrorReader } from "./thread-error-reader.js"

const EVIDENCE_VALIDITY_MS = 15 * 60_000
const MAX_THREAD_LOG_BYTES = 256 * 1_024

export interface UsageLimitEvidence {
  schemaVersion: 1
  observedAt: string
  validUntil: string
  agentId: string
  purpose: "work" | "review"
  classifier: "usageLimitExceeded"
  source: "codex-app-server-v2-event"
  limitId: "codex"
  work: {
    identifier: string
    state: "in_progress" | "reviewing"
    eligible: true
    blockedBy: []
  }
}

export interface UsageLimitEvidenceLifecycle {
  beforeLaunch(): void
  afterExit(issue: LinearIssue, purpose: "work" | "review", logFile: string): Promise<void>
}

interface EvidenceLinearClient {
  getIssue(issueId: string): Promise<LinearIssue>
}

interface EvidenceStore {
  read(): UsageLimitEvidence | null
  publish(evidence: UsageLimitEvidence): void
  removeAny(): void
  removeIfWorkReference(identifier: string): void
}

export class FileUsageLimitEvidenceStore implements EvidenceStore {
  constructor(readonly path: string) {}

  read(): UsageLimitEvidence | null {
    if (!existsSync(this.path)) return null
    validatePrivateFile(this.path)
    return parseUsageLimitEvidence(JSON.parse(readFileSync(this.path, "utf8")))
  }

  publish(evidence: UsageLimitEvidence): void {
    parseUsageLimitEvidence(evidence)
    const directory = dirname(this.path)
    preparePrivateDirectory(directory)
    const temporary = join(directory, `.usage-limit-${randomUUID()}.tmp`)
    try {
      const descriptor = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      )
      try {
        writeFileSync(descriptor, `${JSON.stringify(evidence, null, 2)}\n`)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      renameSync(temporary, this.path)
      syncDirectory(directory)
    } catch (error) {
      if (existsSync(temporary)) {
        unlinkSync(temporary)
        syncDirectory(directory)
      }
      throw error
    }
  }

  removeAny(): void {
    if (!existsSync(this.path)) return
    validatePrivateFile(this.path)
    unlinkSync(this.path)
    syncDirectory(dirname(this.path))
  }

  removeIfWorkReference(identifier: string): void {
    let evidence: UsageLimitEvidence | null
    try {
      evidence = this.read()
    } catch {
      return
    }
    if (evidence?.work.identifier === identifier) this.removeAny()
  }
}

export class StructuredUsageLimitEvidenceLifecycle implements UsageLimitEvidenceLifecycle {
  readonly #config: Config
  readonly #linear: EvidenceLinearClient
  readonly #store: EvidenceStore
  readonly #readerFactory: () => ThreadErrorReader
  readonly #now: () => Date

  constructor(
    config: Config,
    linear: EvidenceLinearClient = new LinearClient(config),
    store: EvidenceStore = new FileUsageLimitEvidenceStore(usageLimitEvidencePath(config)),
    readerFactory: () => ThreadErrorReader = () => new CodexThreadErrorReader(config.codexBin),
    now: () => Date = () => new Date()
  ) {
    this.#config = config
    this.#linear = linear
    this.#store = store
    this.#readerFactory = readerFactory
    this.#now = now
  }

  beforeLaunch(): void {
    this.#store.removeAny()
  }

  async afterExit(
    issue: LinearIssue,
    purpose: "work" | "review",
    logFile: string
  ): Promise<void> {
    const threadId = readCodexExecThreadId(logFile)
    if (!threadId) {
      this.#store.removeIfWorkReference(issue.identifier)
      return
    }

    const reader = this.#readerFactory()
    let usageLimitExceeded = false
    try {
      usageLimitExceeded = await reader.hasUsageLimitExceeded(threadId)
    } catch {
      this.#store.removeIfWorkReference(issue.identifier)
      console.error(`Structured usage-limit verification was unavailable for ${issue.identifier}; no evidence published.`)
      return
    } finally {
      await reader.close().catch(() => {})
    }

    if (!usageLimitExceeded) {
      this.#store.removeIfWorkReference(issue.identifier)
      return
    }

    let currentIssue: LinearIssue
    try {
      currentIssue = await this.#linear.getIssue(issue.id)
    } catch {
      this.#store.removeIfWorkReference(issue.identifier)
      console.error(`Linear eligibility refresh failed for ${issue.identifier}; no evidence published.`)
      return
    }
    const evidence = buildUsageLimitEvidence(this.#config, currentIssue, purpose, this.#now())
    if (!evidence) {
      this.#store.removeIfWorkReference(issue.identifier)
      return
    }
    this.#store.publish(evidence)
    console.log(`Published structured usage-limit evidence for ${issue.identifier}.`)
  }
}

export async function reconcileUsageLimitEvidence(
  config: Config,
  linear: EvidenceLinearClient = new LinearClient(config),
  store: EvidenceStore = new FileUsageLimitEvidenceStore(usageLimitEvidencePath(config)),
  now = new Date()
): Promise<void> {
  let evidence: UsageLimitEvidence | null
  try {
    evidence = store.read()
  } catch {
    store.removeAny()
    return
  }
  if (!evidence) return
  if (Date.parse(evidence.validUntil) < now.getTime()) {
    store.removeIfWorkReference(evidence.work.identifier)
    return
  }

  try {
    const issue = await linear.getIssue(evidence.work.identifier)
    if (!isEligibleIssue(config, issue, evidence.purpose, evidence.agentId)) {
      store.removeIfWorkReference(evidence.work.identifier)
    }
  } catch {
    // Preserve fresh evidence on an ambiguous Linear transport failure. Its
    // short validity bound still makes the steward fail closed.
  }
}

export function buildUsageLimitEvidence(
  config: Config,
  issue: LinearIssue,
  purpose: "work" | "review",
  observedAt: Date
): UsageLimitEvidence | null {
  if (!isEligibleIssue(config, issue, purpose, config.agentId)) return null
  return {
    schemaVersion: 1,
    observedAt: observedAt.toISOString(),
    validUntil: new Date(observedAt.getTime() + EVIDENCE_VALIDITY_MS).toISOString(),
    agentId: config.agentId,
    purpose,
    classifier: "usageLimitExceeded",
    source: "codex-app-server-v2-event",
    limitId: "codex",
    work: {
      identifier: issue.identifier,
      state: purpose === "work" ? "in_progress" : "reviewing",
      eligible: true,
      blockedBy: []
    }
  }
}

export function readCodexExecThreadId(path: string): string | null {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.nlink !== 1) {
    return null
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(descriptor)
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) return null
    const buffer = Buffer.alloc(Math.min(MAX_THREAD_LOG_BYTES, opened.size))
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0)
    return parseCodexExecThreadId(buffer.subarray(0, bytesRead).toString("utf8"))
  } finally {
    closeSync(descriptor)
  }
}

export function parseCodexExecThreadId(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (
      isRecord(event)
      && event.type === "thread.started"
      && typeof event.thread_id === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.thread_id)
    ) return event.thread_id
  }
  return null
}

export function parseUsageLimitEvidence(value: unknown): UsageLimitEvidence {
  if (!isRecord(value) || !isRecord(value.work)) throw new Error("usage-limit-evidence-invalid")
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
    || value.limitId !== "codex"
    || typeof value.work.identifier !== "string"
    || !/^[A-Z][A-Z0-9]+-\d+$/.test(value.work.identifier)
    || !["in_progress", "reviewing"].includes(String(value.work.state))
    || value.work.eligible !== true
    || !Array.isArray(value.work.blockedBy)
    || value.work.blockedBy.length !== 0
  ) throw new Error("usage-limit-evidence-invalid")
  return value as unknown as UsageLimitEvidence
}

export const usageLimitEvidencePath = (config: Config): string =>
  config.usageLimitEvidenceFile ?? join(config.stateDir, "usage-limit-blocked.json")

function isEligibleIssue(
  config: Config,
  issue: LinearIssue,
  purpose: "work" | "review",
  agentId: string
): boolean {
  const expectedStatus = purpose === "work" ? config.runningStatus : config.reviewRunningStatus
  const labelPrefix = purpose === "work" ? "agent" : "reviewer"
  const hasEligibleLabel = issue.labels.nodes.some((label) =>
    matchesLabel(label, `${labelPrefix}:${agentId}`)
    || matchesLabel(label, `${labelPrefix}:any`)
  )
  return issue.state.name === expectedStatus
    && hasEligibleLabel
    && getUnresolvedBlockers(issue).length === 0
}

function preparePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 })
  validateDirectoryChain(path)
  const stat = lstatSync(path)
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || stat.uid !== process.getuid?.()
    || (stat.mode & 0o077) !== 0
  ) throw new Error("usage-limit-evidence-directory-untrusted")
}

function validateDirectoryChain(path: string): void {
  const components = path.split("/").filter(Boolean)
  let current = "/"
  for (const component of components) {
    current = join(current, component)
    const stat = lstatSync(current)
    const trustedOwner = stat.uid === 0 || stat.uid === process.getuid?.()
    const writableByOthers = (stat.mode & 0o022) !== 0
    const protectedTemporaryRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0
    if (
      !stat.isDirectory()
      || stat.isSymbolicLink()
      || !trustedOwner
      || (writableByOthers && !protectedTemporaryRoot)
    ) {
      throw new Error("usage-limit-evidence-directory-untrusted")
    }
  }
}

function validatePrivateFile(path: string): void {
  const stat = lstatSync(path)
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.uid !== process.getuid?.()
    || (stat.mode & 0o077) !== 0
    || stat.nlink !== 1
  ) throw new Error("usage-limit-evidence-file-untrusted")
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
