import { resolve } from "node:path";
import { mergeEnvFile } from "./env/files.js";
import { parseArgs } from "./env/args.js";
import type { CliOptions, Config, EnvMap } from "./env/types.js";

export { parseArgs };

const FLAG_ENV_KEYS = [
  ["linear-api-key", "LINEAR_API_KEY"],
  ["linear-api-url", "CODEX_LINEAR_API_URL"],
  ["team-key", "CODEX_LINEAR_TEAM_KEY"],
  ["agent-id", "CODEX_LINEAR_AGENT_ID"],
  ["agent-labels", "CODEX_LINEAR_AGENT_LABELS"],
  ["ready-status", "CODEX_LINEAR_READY_STATUS"],
  ["running-status", "CODEX_LINEAR_RUNNING_STATUS"],
  ["blocked-status", "CODEX_LINEAR_BLOCKED_STATUS"],
  ["review-status", "CODEX_LINEAR_REVIEW_STATUS"],
  ["default-model", "CODEX_LINEAR_DEFAULT_MODEL"],
  ["default-sandbox", "CODEX_LINEAR_DEFAULT_SANDBOX"],
  ["codex-bin", "CODEX_LINEAR_CODEX_BIN"],
  ["codex-cwd", "CODEX_LINEAR_CODEX_CWD"],
  ["codex-extra-args", "CODEX_LINEAR_CODEX_EXTRA_ARGS"],
  ["state-dir", "CODEX_LINEAR_STATE_DIR"],
  ["wait-timeout-seconds", "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS"],
  ["lock-stale-seconds", "CODEX_LINEAR_LOCK_STALE_SECONDS"],
  ["fetch-limit", "CODEX_LINEAR_FETCH_LIMIT"]
] as const;

export function loadConfig(options: CliOptions, cwd: string): Config {
  const merged: EnvMap = {};

  mergeEnvFile(merged, resolve(cwd, ".env.defaults"), false);
  mergeEnvFile(merged, resolve(cwd, ".env.local"), false);
  options.envFiles.forEach((envFile) => mergeEnvFile(merged, resolve(cwd, envFile), true));
  Object.assign(merged, process.env);
  applyFlags(merged, options.flags);

  const linearApiKey = required(merged, "LINEAR_API_KEY");
  const stateDir = value(merged, "CODEX_LINEAR_STATE_DIR", `${process.env.HOME ?? "."}/.local/state/codex-linear-work-delegator`);

  return {
    linearApiKey,
    linearApiUrl: value(merged, "CODEX_LINEAR_API_URL", "https://api.linear.app/graphql"),
    teamKey: optional(merged, "CODEX_LINEAR_TEAM_KEY"),
    agentId: value(merged, "CODEX_LINEAR_AGENT_ID", "daedalus"),
    agentLabels: list(value(merged, "CODEX_LINEAR_AGENT_LABELS", "agent:daedalus,agent:any")),
    readyStatus: value(merged, "CODEX_LINEAR_READY_STATUS", "Waiting For Agent"),
    runningStatus: value(merged, "CODEX_LINEAR_RUNNING_STATUS", "Agent In Progress"),
    blockedStatus: value(merged, "CODEX_LINEAR_BLOCKED_STATUS", "Blocked"),
    reviewStatus: value(merged, "CODEX_LINEAR_REVIEW_STATUS", "In Review"),
    defaultModel: value(merged, "CODEX_LINEAR_DEFAULT_MODEL", "gpt-5.5"),
    defaultSandbox: value(merged, "CODEX_LINEAR_DEFAULT_SANDBOX", "danger-full-access"),
    codexBin: value(merged, "CODEX_LINEAR_CODEX_BIN", "codex"),
    codexCwd: value(merged, "CODEX_LINEAR_CODEX_CWD", process.cwd()),
    codexExtraArgs: splitArgs(value(merged, "CODEX_LINEAR_CODEX_EXTRA_ARGS", "")),
    stateDir,
    waitTimeoutMs: seconds(merged, "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS", 60),
    lockStaleMs: seconds(merged, "CODEX_LINEAR_LOCK_STALE_SECONDS", 600),
    fetchLimit: integer(merged, "CODEX_LINEAR_FETCH_LIMIT", 50),
    dryRun: options.flags["dry-run"] === true,
    noSpawn: options.flags["no-spawn"] === true
  };
}

function applyFlags(env: EnvMap, flags: CliOptions["flags"]): void {
  FLAG_ENV_KEYS.forEach(([flag, key]) => {
    const flagValue = flags[flag];
    if (typeof flagValue === "string") env[key] = flagValue;
  });
}

function required(env: EnvMap, key: string): string {
  const found = optional(env, key);
  if (!found) throw new Error(`Missing required configuration: ${key}`);
  return found;
}

function optional(env: EnvMap, key: string): string | undefined {
  const found = env[key]?.trim();
  return found ? found : undefined;
}

function value(env: EnvMap, key: string, fallback: string): string {
  return optional(env, key) ?? fallback;
}

function list(input: string): string[] {
  return input.split(",").map((item) => item.trim()).filter(Boolean);
}

function seconds(env: EnvMap, key: string, fallback: number): number {
  return integer(env, key, fallback) * 1000;
}

function integer(env: EnvMap, key: string, fallback: number): number {
  const raw = optional(env, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative integer`);
  return parsed;
}

function splitArgs(input: string): string[] {
  return input.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}
