import { formatLabel } from "../linear/labels.js";
import type { Config } from "../env/types.js";
import type { LinearIssue } from "../linear/types.js";

export interface CodexLaunchOptions {
  model: string;
  sandbox: string;
  reasoningEffort?: string;
}

export function getCodexLaunchOptions(config: Config, issue: LinearIssue): CodexLaunchOptions {
  const labels = issue.labels.nodes.map(formatLabel);

  return {
    model: findPrefixedLabel(labels, "agent:model:") ?? config.defaultModel,
    sandbox: findPrefixedLabel(labels, "agent:sandbox:") ?? config.defaultSandbox,
    reasoningEffort: findPrefixedLabel(labels, "agent:reasoning:")
  };
}

export function buildCodexArgs(config: Config, options: CodexLaunchOptions, prompt: string): string[] {
  return [
    "exec",
    "--model", options.model,
    ...reasoningArgs(options.reasoningEffort),
    "--sandbox", options.sandbox,
    "--skip-git-repo-check",
    "--cd", config.codexCwd,
    ...config.codexExtraArgs,
    prompt
  ];
}

function reasoningArgs(reasoningEffort?: string): string[] {
  return reasoningEffort ? ["-c", `model_reasoning_effort="${reasoningEffort}"`] : [];
}

function findPrefixedLabel(labels: string[], prefix: string): string | undefined {
  const match = labels.find((label) => label.startsWith(prefix));
  return match?.slice(prefix.length).trim() || undefined;
}
