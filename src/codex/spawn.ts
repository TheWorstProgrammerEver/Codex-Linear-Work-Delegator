import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { writeCurrentState } from "../state.js";
import { buildCodexArgs, getCodexLaunchOptions } from "./options.js";
import { buildPrompt } from "./prompt.js";
import { waitForChildOrTimeout } from "./wait.js";
import type { Config } from "../env/types.js";
import type { LinearIssue } from "../linear/types.js";
import type { CurrentState } from "../state.js";

export async function spawnCodexForIssue(config: Config, issue: LinearIssue): Promise<void> {
  const launchOptions = getCodexLaunchOptions(config, issue);
  const logFile = openIssueLog(config.stateDir, issue.identifier);
  const logFd = openSync(logFile, "a");
  const prompt = buildPrompt(config, issue);
  const args = buildCodexArgs(config, launchOptions, prompt);

  const child = spawn(config.codexBin, args, {
    cwd: config.codexCwd,
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  closeSync(logFd);

  const currentState = buildCurrentState(issue, child.pid ?? -1, launchOptions.model, logFile);
  writeCurrentState(config, currentState);
  logSpawn(currentState, launchOptions.sandbox, launchOptions.reasoningEffort);

  await waitForChildOrTimeout(config, currentState.pid, child);
}

function openIssueLog(stateDir: string, issueIdentifier: string): string {
  mkdirSync(join(stateDir, "logs"), { recursive: true });
  return join(stateDir, "logs", `${issueIdentifier}-${Date.now()}.log`);
}

function buildCurrentState(issue: LinearIssue, pid: number, model: string, logFile: string): CurrentState {
  return {
    issueId: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    pid,
    model,
    startedAt: new Date().toISOString(),
    logFile
  };
}

function logSpawn(state: CurrentState, sandbox: string, reasoningEffort?: string): void {
  const reasoning = reasoningEffort ? ` reasoning=${reasoningEffort}` : "";
  console.log(`Spawned Codex pid=${state.pid} model=${state.model} sandbox=${sandbox}${reasoning} issue=${state.identifier}`);
  console.log(`Log: ${state.logFile}`);
}
