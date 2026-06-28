import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Config, CurrentState, LinearIssue, LinearLabel } from "./types.js";
import { clearCurrentState, writeCurrentState } from "./state.js";

export async function spawnCodexForIssue(config: Config, issue: LinearIssue): Promise<void> {
  const labelNames = issue.labels.nodes.map((label) => label.name);
  const model = findPrefixedLabel(labelNames, "agent:model:") ?? config.defaultModel;
  const sandbox = findPrefixedLabel(labelNames, "agent:sandbox:") ?? config.defaultSandbox;

  mkdirSync(join(config.stateDir, "logs"), { recursive: true });
  const logFile = join(config.stateDir, "logs", `${issue.identifier}-${Date.now()}.log`);
  const logFd = openSync(logFile, "a");

  const args = [
    "exec",
    "--model", model,
    "--sandbox", sandbox,
    "--skip-git-repo-check",
    "--cd", config.codexCwd,
    ...config.codexExtraArgs,
    buildPrompt(config, issue)
  ];

  const child = spawn(config.codexBin, args, {
    cwd: config.codexCwd,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  closeSync(logFd);

  const currentState: CurrentState = {
    issueId: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    pid: child.pid ?? -1,
    model,
    startedAt: new Date().toISOString(),
    logFile
  };
  writeCurrentState(config, currentState);

  console.log(`Spawned Codex pid=${currentState.pid} model=${model} sandbox=${sandbox} issue=${issue.identifier}`);
  console.log(`Log: ${logFile}`);

  await waitForChildOrTimeout(config, child.pid ?? -1, child);
}

function buildPrompt(config: Config, issue: LinearIssue): string {
  return [
    `You are the local Pi worker "${config.agentId}" working a Linear issue that has already been claimed for you.`,
    "",
    `Issue: ${issue.identifier}`,
    `Title: ${issue.title}`,
    `URL: ${issue.url}`,
    "",
    "Linear issue snapshot at claim time:",
    "```json",
    JSON.stringify(buildIssueSnapshot(issue), null, 2),
    "```",
    "",
    "Use the configured Linear MCP/tools if available to read the full issue, comments, and current state.",
    "Start from the snapshot above, but refresh Linear if anything appears stale or incomplete.",
    "Work locally on this Raspberry Pi. Do not use Codex Cloud Tasks.",
    "",
    "When complete:",
    `- update Linear with a concise result summary;`,
    `- move the issue to "${config.reviewStatus}" if the work is ready for human review.`,
    "",
    "If blocked:",
    `- update Linear with the blocker and what is needed;`,
    `- move the issue to "${config.blockedStatus}".`,
    "",
    "Keep changes scoped to the issue. Run relevant verification before reporting completion."
  ].join("\n");
}

function buildIssueSnapshot(issue: LinearIssue): Record<string, unknown> {
  return {
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description ?? "",
    priority: {
      value: issue.priority,
      label: issue.priorityLabel ?? null
    },
    status: {
      name: issue.state.name,
      type: issue.state.type ?? null
    },
    team: issue.team,
    labels: issue.labels.nodes.map(formatLabel),
    assignee: issue.assignee ? personSnapshot(issue.assignee) : null,
    creator: issue.creator ? personSnapshot(issue.creator) : null,
    project: issue.project ? { id: issue.project.id, name: issue.project.name } : null,
    cycle: issue.cycle ? { id: issue.cycle.id, name: issue.cycle.name } : null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    recentComments: issue.comments?.nodes.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      user: comment.user ? personSnapshot(comment.user) : null
    })) ?? []
  };
}

function formatLabel(label: LinearLabel): string {
  return label.parent?.name ? `${label.parent.name}:${label.name}` : label.name;
}

function personSnapshot(person: { id: string; name: string; email?: string | null }): Record<string, string | null> {
  return {
    id: person.id,
    name: person.name,
    email: person.email ?? null
  };
}

async function waitForChildOrTimeout(config: Config, pid: number, child: ReturnType<typeof spawn>): Promise<void> {
  if (config.waitTimeoutMs === 0) {
    child.unref();
    return;
  }

  const result = await new Promise<"exit" | "timeout">((resolve) => {
    const timeout = setTimeout(() => resolve("timeout"), config.waitTimeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve("exit");
    });
  });

  if (result === "exit") {
    clearCurrentState(config, pid);
    console.log(`Codex child pid=${pid} exited before wait timeout.`);
    return;
  }

  child.unref();
  console.log(`Codex child pid=${pid} is still running after wait timeout; leaving state for next scheduler run.`);
}

function findPrefixedLabel(labels: string[], prefix: string): string | undefined {
  const match = labels.find((label) => label.startsWith(prefix));
  return match?.slice(prefix.length).trim() || undefined;
}
