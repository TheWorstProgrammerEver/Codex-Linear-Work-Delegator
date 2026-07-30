import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface CodexReadinessDescriptor {
  codexBin: string
  model: string
}

export type CodexReadinessResult =
  | { ready: true; code: "ready" }
  | {
    ready: false
    code:
      | "authentication-failed"
      | "probe-activity-detected"
      | "probe-output-invalid"
      | "probe-process-failed"
  }

interface ProbeEvent {
  type?: string
  item?: {
    type?: string
    text?: string
  }
  [key: string]: unknown
}

const READY_MARKER = "CODEX_AUTH_READY"
const PROBE_PROMPT = [
  "This is a non-mutating execution-auth readiness probe.",
  "Do not use tools.",
  `Reply with exactly ${READY_MARKER} and nothing else.`
].join(" ")
const SAFE_ITEM_TYPES = new Set(["agent_message", "reasoning"])
const AUTH_ERROR_PATTERNS = [
  /\b401\b[^\n]{0,120}\b(?:unauthorized|authentication)\b/i,
  /\b(?:authentication failed|not authenticated|invalid api key|invalid_api_key)\b/i
]

export async function checkCodexReadiness(
  descriptor: CodexReadinessDescriptor
): Promise<CodexReadinessResult> {
  const probeDir = mkdtempSync(join(tmpdir(), "codex-linear-readiness-"))

  try {
    const args = buildCodexReadinessArgs(descriptor, probeDir)

    try {
      const probe = spawnSync(descriptor.codexBin, args, {
        encoding: "utf8",
        input: "",
        maxBuffer: 256 * 1024,
        timeout: 90_000
      })
      const processSucceeded = probe.status === 0 && probe.signal === null && !probe.error
      return classifyProbeOutput(probe.stdout ?? "", probe.stderr ?? "", processSucceeded)
    } catch {
      return { ready: false, code: "probe-process-failed" }
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

export const buildCodexReadinessArgs = (
  descriptor: CodexReadinessDescriptor,
  probeDir: string
): string[] => [
  "exec",
  "--ephemeral",
  "--json",
  "--ignore-rules",
  "--model", descriptor.model,
  "-c", "model_reasoning_effort=\"low\"",
  "--sandbox", "read-only",
  "--skip-git-repo-check",
  "--cd", probeDir,
  PROBE_PROMPT
]

function classifyProbeOutput(
  stdout: string,
  stderr: string,
  processSucceeded: boolean
): CodexReadinessResult {
  const parsed = parseProbeEvents(stdout)
  const authenticationEvidence = [
    stderr,
    ...parsed.events
      .filter((event) => event.type === "error" || event.type?.endsWith(".failed"))
      .flatMap(collectStrings)
  ].join("\n")

  if (matchesAuthenticationFailure(authenticationEvidence) && !parsed.activityDetected) {
    return { ready: false, code: "authentication-failed" }
  }

  if (parsed.activityDetected) {
    return { ready: false, code: "probe-activity-detected" }
  }

  if (!parsed.valid) {
    return { ready: false, code: "probe-output-invalid" }
  }

  const completed = parsed.events.some((event) => event.type === "turn.completed")
  const marker = parsed.events.some((event) =>
    event.type === "item.completed" &&
    event.item?.type === "agent_message" &&
    event.item.text?.trim() === READY_MARKER
  )

  return processSucceeded && completed && marker
    ? { ready: true, code: "ready" }
    : { ready: false, code: "probe-process-failed" }
}

function parseProbeEvents(stdout: string): {
  activityDetected: boolean
  events: ProbeEvent[]
  valid: boolean
} {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const events: ProbeEvent[] = []

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as ProbeEvent)
    } catch {
      return { activityDetected: false, events, valid: false }
    }
  }

  const activityDetected = events.some((event) =>
    (event.type === "item.started" || event.type === "item.completed") &&
    typeof event.item?.type === "string" &&
    !SAFE_ITEM_TYPES.has(event.item.type)
  )

  return { activityDetected, events, valid: lines.length > 0 }
}

const matchesAuthenticationFailure = (text: string): boolean =>
  AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text))

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (typeof value !== "object" || value === null) return []
  return Object.values(value).flatMap(collectStrings)
}
