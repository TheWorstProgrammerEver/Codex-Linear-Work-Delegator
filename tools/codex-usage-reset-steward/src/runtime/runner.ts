import { existsSync } from "node:fs"
import { AuditLog, buildAuditRecord, outcomeToAuditResult } from "../audit/audit-log.js"
import { SystemClockSource } from "../clock/stable-clock.js"
import { CodexAppServer } from "../app-server/client.js"
import { readBlockedWorkEvidence } from "../evidence/blocked-work.js"
import { evaluatePolicy } from "../policy/evaluate.js"
import {
  FileStateStore,
  createPendingAttempt
} from "../state/steward-state.js"
import type { AppServer } from "../app-server/client.js"
import type { AuditLog as AuditLogType, AuditResult } from "../audit/audit-log.js"
import type { ClockSource } from "../clock/stable-clock.js"
import type { BlockedWorkEvidence } from "../evidence/blocked-work.js"
import type { PolicyDecision } from "../policy/evaluate.js"
import type { ReasonCode } from "../policy/evaluate.js"
import type {
  ConsumeOutcome,
  PendingAttempt,
  StateStore,
  StewardState
} from "../state/steward-state.js"
import type { RuntimeConfig } from "./config.js"

const CODE_VERSION = "0.1.0"

export interface RunDependencies {
  appServer: AppServer
  stateStore: StateStore
  auditLog: Pick<AuditLogType, "append">
  clock: ClockSource
  readEvidence: () => BlockedWorkEvidence | null
  killSwitchActive: () => boolean
  now: () => Date
  fault?: (point: "after_prepare" | "after_dispatch" | "after_outcome") => void
}

export interface RunResult {
  result: AuditResult
  decision: PolicyDecision
}

export function createRunDependencies(config: RuntimeConfig): RunDependencies {
  return {
    appServer: new CodexAppServer(config.codexBin),
    stateStore: new FileStateStore(config.stateFile, config.policy.sha256),
    auditLog: new AuditLog(config.auditFile),
    clock: new SystemClockSource(),
    readEvidence: () => readBlockedWorkEvidence(config.evidenceFile),
    killSwitchActive: () => existsSync(config.killSwitchFile),
    now: () => new Date()
  }
}

export async function runSteward(
  config: RuntimeConfig,
  dependencies = createRunDependencies(config)
): Promise<RunResult> {
  const { config: policy } = config.policy
  let state = dependencies.stateStore.read()
  const now = dependencies.now()
  const clockCheck = dependencies.clock.check(state.clockObservation, policy.maximumClockSkewSeconds)
  state = { ...state, clockObservation: clockCheck.observation }
  dependencies.stateStore.write(state)

  try {
    if (state.pending) {
      return await recoverPending(config, dependencies, state, clockCheck.stable, now)
    }

    const initialRateLimits = await dependencies.appServer.readRateLimits()
    const evidence = dependencies.readEvidence()
    const initialDecision = evaluatePolicy(policy, {
      nowMs: now.getTime(),
      mode: config.mode,
      configuredOwner: config.configuredOwner,
      policyApproved: config.policyApproved,
      killSwitchActive: dependencies.killSwitchActive(),
      clockStable: clockCheck.stable,
      evidence,
      rateLimits: initialRateLimits,
      lastConsumedAt: state.lastConsumedAt
    })

    if (config.mode === "dry-run" || !initialDecision.consume) {
      const result = config.mode === "dry-run" ? "dry_run" : "policy_blocked"
      audit(config, dependencies, now, initialDecision, result)
      return { result, decision: initialDecision }
    }

    const preflightRateLimits = await dependencies.appServer.readRateLimits()
    const preflightEvidence = dependencies.readEvidence()
    const preflightNow = dependencies.now()
    const decision = evaluatePolicy(policy, {
      nowMs: preflightNow.getTime(),
      mode: config.mode,
      configuredOwner: config.configuredOwner,
      policyApproved: config.policyApproved,
      killSwitchActive: dependencies.killSwitchActive(),
      clockStable: clockCheck.stable,
      evidence: preflightEvidence,
      rateLimits: preflightRateLimits,
      lastConsumedAt: state.lastConsumedAt
    })
    if (!decision.consume) {
      audit(config, dependencies, preflightNow, decision, "policy_blocked")
      return { result: "policy_blocked", decision }
    }

    const pending = createPendingAttempt(preflightNow, decision.workReference as string)
    state = { ...state, pending }
    dependencies.stateStore.write(state)
    dependencies.fault?.("after_prepare")
    return await dispatchPending(config, dependencies, state, decision, preflightNow)
  } finally {
    await dependencies.appServer.close()
  }
}

async function recoverPending(
  config: RuntimeConfig,
  dependencies: RunDependencies,
  state: StewardState,
  clockStable: boolean,
  now: Date
): Promise<RunResult> {
  const pending = state.pending as PendingAttempt
  const decision = pendingDecision(pending)
  const pendingAgeMs = now.getTime() - Date.parse(pending.preparedAt)
  const authorityReasons: ReasonCode[] = []
  if (config.mode !== "consume") authorityReasons.push("pending_recovery_not_authorized")
  if (!config.policyApproved) authorityReasons.push("policy_digest_unapproved")
  if (config.configuredOwner !== config.policy.config.designatedOwner) authorityReasons.push("owner_mismatch")
  if (dependencies.killSwitchActive()) authorityReasons.push("kill_switch_active")
  if (!clockStable) authorityReasons.push("clock_unstable")
  if (
    pending.phase !== "outcome_received"
    && (
      pendingAgeMs < 0
      || pendingAgeMs > config.policy.config.maximumPendingAgeMinutes * 60_000
    )
  ) authorityReasons.push("pending_attempt_expired")
  if (authorityReasons.length > 0) {
    const blockedDecision = {
      ...decision,
      consume: false,
      reasons: authorityReasons.sort()
    }
    audit(config, dependencies, now, blockedDecision, "policy_blocked")
    return { result: "policy_blocked", decision: blockedDecision }
  }
  if (pending.phase === "outcome_received") {
    return finalizeOutcome(config, dependencies, state, decision, now)
  }
  if (pending.phase === "prepared") {
    const preflightRateLimits = await dependencies.appServer.readRateLimits()
    const preflightEvidence = dependencies.readEvidence()
    const preflightNow = dependencies.now()
    const refreshedDecision = evaluatePolicy(config.policy.config, {
      nowMs: preflightNow.getTime(),
      mode: config.mode,
      configuredOwner: config.configuredOwner,
      policyApproved: config.policyApproved,
      killSwitchActive: dependencies.killSwitchActive(),
      clockStable,
      evidence: preflightEvidence,
      rateLimits: preflightRateLimits,
      lastConsumedAt: state.lastConsumedAt
    })
    if (refreshedDecision.workReference !== pending.workReference) {
      refreshedDecision.consume = false
      refreshedDecision.reasons = [
        ...new Set([...refreshedDecision.reasons, "evidence_work_mismatch" as const])
      ].sort()
    }
    if (!refreshedDecision.consume) {
      audit(config, dependencies, preflightNow, refreshedDecision, "policy_blocked")
      return { result: "policy_blocked", decision: refreshedDecision }
    }
    return dispatchPending(config, dependencies, state, refreshedDecision, preflightNow)
  }
  return dispatchPending(config, dependencies, state, decision, now)
}

async function dispatchPending(
  config: RuntimeConfig,
  dependencies: RunDependencies,
  state: StewardState,
  decision: PolicyDecision,
  now: Date
): Promise<RunResult> {
  let pending = state.pending as PendingAttempt
  if (dependencies.killSwitchActive()) {
    const blockedDecision: PolicyDecision = {
      ...decision,
      consume: false,
      reasons: ["kill_switch_active"]
    }
    audit(config, dependencies, now, blockedDecision, "policy_blocked")
    return { result: "policy_blocked", decision: blockedDecision }
  }
  if (pending.phase === "prepared") {
    pending = { ...pending, phase: "dispatched" }
    state = { ...state, pending }
    dependencies.stateStore.write(state)
  }
  dependencies.fault?.("after_dispatch")

  let outcome: ConsumeOutcome
  try {
    outcome = await dependencies.appServer.consumeReset(pending.idempotencyKey)
  } catch {
    audit(config, dependencies, now, decision, "ambiguous_transport")
    return { result: "ambiguous_transport", decision }
  }

  state = {
    ...state,
    pending: { ...pending, phase: "outcome_received", outcome }
  }
  dependencies.stateStore.write(state)
  dependencies.fault?.("after_outcome")
  return finalizeOutcome(config, dependencies, state, decision, dependencies.now())
}

async function finalizeOutcome(
  config: RuntimeConfig,
  dependencies: RunDependencies,
  state: StewardState,
  decision: PolicyDecision,
  now: Date
): Promise<RunResult> {
  const outcome = state.pending?.outcome
  if (!outcome) throw new Error("pending-outcome-missing")
  if (outcome === "reset" || outcome === "alreadyRedeemed") {
    await dependencies.appServer.readRateLimits()
    state = { ...state, lastConsumedAt: now.toISOString(), pending: null }
  } else {
    state = { ...state, pending: null }
  }
  dependencies.stateStore.write(state)
  const result = outcomeToAuditResult(outcome)
  audit(config, dependencies, now, decision, result)
  return { result, decision }
}

function pendingDecision(pending: PendingAttempt): PolicyDecision {
  return {
    consume: true,
    reasons: [],
    workReference: pending.workReference,
    creditAvailability: "available",
    exhaustedEligibleBucket: true
  }
}

function audit(
  config: RuntimeConfig,
  dependencies: RunDependencies,
  now: Date,
  decision: PolicyDecision,
  result: AuditResult
): void {
  dependencies.auditLog.append(buildAuditRecord({
    timestamp: now.toISOString(),
    policyVersion: config.policy.config.policyVersion,
    policySha256: config.policy.sha256,
    codeVersion: CODE_VERSION,
    mode: config.mode,
    decision,
    result
  }))
}
