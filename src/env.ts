import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CliOptions, Config, EnvMap } from "./types.js";

export function parseArgs(argv: string[]): CliOptions {
  const envFiles: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const name = rawName.trim();
    const value = inlineValue ?? argv[index + 1];

    if (name === "env-file") {
      if (inlineValue === undefined) index += 1;
      if (!value || value.startsWith("--")) throw new Error("--env-file requires a path");
      envFiles.push(value);
      continue;
    }

    if (name === "dry-run" || name === "no-spawn" || name === "help") {
      flags[name] = true;
      continue;
    }

    if (inlineValue === undefined) index += 1;
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    flags[name] = value;
  }

  return { envFiles, flags };
}

export function loadConfig(options: CliOptions, cwd: string): Config {
  const merged: EnvMap = {};

  mergeEnvFile(merged, resolve(cwd, ".env.defaults"), false);
  mergeEnvFile(merged, resolve(cwd, ".env.local"), false);
  for (const envFile of options.envFiles) mergeEnvFile(merged, resolve(cwd, envFile), true);
  Object.assign(merged, process.env);

  applyFlag(merged, options.flags, "linear-api-key", "LINEAR_API_KEY");
  applyFlag(merged, options.flags, "team-key", "CODEX_LINEAR_TEAM_KEY");
  applyFlag(merged, options.flags, "agent-id", "CODEX_LINEAR_AGENT_ID");
  applyFlag(merged, options.flags, "agent-labels", "CODEX_LINEAR_AGENT_LABELS");
  applyFlag(merged, options.flags, "ready-status", "CODEX_LINEAR_READY_STATUS");
  applyFlag(merged, options.flags, "running-status", "CODEX_LINEAR_RUNNING_STATUS");
  applyFlag(merged, options.flags, "default-model", "CODEX_LINEAR_DEFAULT_MODEL");
  applyFlag(merged, options.flags, "default-sandbox", "CODEX_LINEAR_DEFAULT_SANDBOX");
  applyFlag(merged, options.flags, "codex-cwd", "CODEX_LINEAR_CODEX_CWD");
  applyFlag(merged, options.flags, "state-dir", "CODEX_LINEAR_STATE_DIR");
  applyFlag(merged, options.flags, "wait-timeout-seconds", "CODEX_LINEAR_WAIT_TIMEOUT_SECONDS");

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

function mergeEnvFile(target: EnvMap, filePath: string, requiredFile: boolean): void {
  if (!existsSync(filePath)) {
    if (requiredFile) throw new Error(`Env file does not exist: ${filePath}`);
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    target[key] = unquote(rawValue);
  }
}

function applyFlag(env: EnvMap, flags: Record<string, string | boolean>, flag: string, key: string): void {
  const flagValue = flags[flag];
  if (typeof flagValue === "string") env[key] = flagValue;
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

function unquote(input: string): string {
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    return input.slice(1, -1);
  }
  return input;
}

function splitArgs(input: string): string[] {
  return input.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}
