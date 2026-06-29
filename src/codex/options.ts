import { formatLabel } from "../linear/labels.js"
import type { Config } from "../env/types.js"
import type { LinearIssue } from "../linear/types.js"

export interface CodexLaunchOptions {
  model: string
  sandbox: string
  reasoningEffort?: string
}

export const getCodexLaunchOptions = (config: Config, issue: LinearIssue): CodexLaunchOptions => {
  const labels = issue.labels.nodes.map(formatLabel)

  return {
    model: findPrefixedLabel(labels, "agent:model:") ?? config.defaultModel,
    sandbox: findPrefixedLabel(labels, "agent:sandbox:") ?? config.defaultSandbox,
    reasoningEffort: findPrefixedLabel(labels, "agent:reasoning:")
  }
}

export const buildCodexArgs = (config: Config, options: CodexLaunchOptions, prompt: string): string[] => [
  "exec",
  "--model", options.model,
  ...reasoningArgs(options.reasoningEffort),
  "--sandbox", options.sandbox,
  "--skip-git-repo-check",
  "--cd", config.codexCwd,
  ...config.codexExtraArgs,
  prompt
]

const reasoningArgs = (reasoningEffort?: string): string[] =>
  reasoningEffort ? ["-c", `model_reasoning_effort="${reasoningEffort}"`] : []

const findPrefixedLabel = (labels: string[], prefix: string): string | undefined =>
  labels.find((label) => label.startsWith(prefix))?.slice(prefix.length).trim() || undefined
