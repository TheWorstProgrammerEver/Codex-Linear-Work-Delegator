import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { loadPolicy } from "../policy/policy-config.js"
import { SOURCE_POLICY_SHA256 } from "../policy/source-policy.js"
import type { LoadedPolicy } from "../policy/policy-config.js"

export interface RuntimeConfig {
  mode: "dry-run" | "consume"
  configuredOwner: string
  policy: LoadedPolicy
  policyApproved: boolean
  policyPath: string
  stateFile: string
  auditFile: string
  evidenceFile: string
  killSwitchFile: string
  lockFile: string
  codexBin: string
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): RuntimeConfig {
  const modeValue = environment.CODEX_RESET_STEWARD_MODE ?? "dry-run"
  if (modeValue !== "dry-run" && modeValue !== "consume") throw new Error("mode-invalid")
  const stateDirectory = environment.CODEX_RESET_STEWARD_STATE_DIR
    ?? join(homedir(), ".local", "state", "codex-usage-reset-steward")
  const policyPath = environment.CODEX_RESET_STEWARD_POLICY
    ?? resolve(cwd, "config", "policy.default.json")
  const policy = loadPolicy(policyPath)
  const approvedDigest = environment.CODEX_RESET_STEWARD_APPROVED_POLICY_SHA256
  return {
    mode: modeValue,
    configuredOwner: environment.CODEX_RESET_STEWARD_OWNER ?? policy.config.designatedOwner,
    policy,
    policyApproved: approvedDigest === SOURCE_POLICY_SHA256,
    policyPath,
    stateFile: join(stateDirectory, "state.json"),
    auditFile: environment.CODEX_RESET_STEWARD_AUDIT_FILE ?? join(stateDirectory, "audit.jsonl"),
    evidenceFile: environment.CODEX_RESET_STEWARD_EVIDENCE_FILE
      ?? join(homedir(), ".local", "state", "codex-usage-reset-steward", "usage-limit-blocked.json"),
    killSwitchFile: environment.CODEX_RESET_STEWARD_KILL_SWITCH
      ?? "/etc/codex-usage-reset-steward/disabled",
    lockFile: environment.CODEX_RESET_STEWARD_LOCK_FILE
      ?? join("/run", "user", String(process.getuid?.() ?? ""), "codex-usage-reset-steward.lock"),
    codexBin: environment.CODEX_RESET_STEWARD_CODEX_BIN ?? "codex"
  }
}
