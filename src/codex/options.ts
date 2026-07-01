import { formatLabel } from "../linear/labels.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"

export interface CodexLaunchOptions {
  model: string
  sandbox: string
  reasoningEffort?: string
  speed?: CodexSpeed
}

export type CodexSpeed = "fast" | "standard"

const SPEED_LABEL_PREFIX = "agent:speed:"
const FAST_MODE_MODELS = new Set(["gpt-5.5", "gpt-5.4"])

export class InvalidCodexLaunchOptionsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidCodexLaunchOptionsError"
  }
}

export const getCodexLaunchOptions = (config: Config, issue: LinearIssue): CodexLaunchOptions => {
  const labels = issue.labels.nodes.map(formatLabel)
  const model = findPrefixedLabel(labels, "agent:model:") ?? config.defaultModel
  const speed = findSpeedLabel(labels)

  if (speed === "fast" && !FAST_MODE_MODELS.has(model)) {
    throw new InvalidCodexLaunchOptionsError(
      `Issue requests agent:speed:fast, but model "${model}" does not support Codex Fast mode. Supported Fast mode models: ${[...FAST_MODE_MODELS].join(", ")}.`
    )
  }

  return {
    model,
    sandbox: findPrefixedLabel(labels, "agent:sandbox:") ?? config.defaultSandbox,
    reasoningEffort: findPrefixedLabel(labels, "agent:reasoning:"),
    speed
  }
}

export const buildCodexArgs = (config: Config, options: CodexLaunchOptions, prompt: string): string[] => [
  "exec",
  "--model", options.model,
  ...reasoningArgs(options.reasoningEffort),
  ...speedArgs(options.speed),
  "--sandbox", options.sandbox,
  "--skip-git-repo-check",
  "--cd", config.codexCwd,
  ...config.codexExtraArgs,
  prompt
]

const reasoningArgs = (reasoningEffort?: string): string[] =>
  reasoningEffort ? ["-c", `model_reasoning_effort="${reasoningEffort}"`] : []

const speedArgs = (speed?: CodexSpeed): string[] => {
  if (speed === "fast") return ["--enable", "fast_mode", "-c", `service_tier="fast"`]
  if (speed === "standard") return ["--disable", "fast_mode"]
  return []
}

const findPrefixedLabel = (labels: string[], prefix: string): string | undefined =>
  labels.find((label) => label.startsWith(prefix))?.slice(prefix.length).trim() || undefined

const findSpeedLabel = (labels: string[]): CodexSpeed | undefined => {
  const speedLabels = labels
    .filter((label) => label.startsWith(SPEED_LABEL_PREFIX))
    .map((label) => label.slice(SPEED_LABEL_PREFIX.length).trim())
    .filter(Boolean)

  const uniqueSpeedLabels = [...new Set(speedLabels)]
  if (uniqueSpeedLabels.length === 0) return undefined
  if (uniqueSpeedLabels.length > 1) {
    throw new InvalidCodexLaunchOptionsError(
      `Issue has conflicting speed labels: ${uniqueSpeedLabels.map((speed) => `${SPEED_LABEL_PREFIX}${speed}`).join(", ")}. Use exactly one of agent:speed:fast or agent:speed:standard.`
    )
  }

  const [speed] = uniqueSpeedLabels
  if (speed === "fast" || speed === "standard") return speed

  throw new InvalidCodexLaunchOptionsError(
    `Issue has unsupported speed label agent:speed:${speed}. Use exactly one of agent:speed:fast or agent:speed:standard.`
  )
}
