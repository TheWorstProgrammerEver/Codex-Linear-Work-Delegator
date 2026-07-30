import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { AuditLog, buildAuditRecord } from "../src/audit/audit-log.js"
import { evaluateClockStability } from "../src/clock/stable-clock.js"
import {
  FileStateStore,
  createInitialState,
  parseStewardState
} from "../src/state/steward-state.js"
import { runtimeConfig } from "./fixtures.js"

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codex-reset-steward-test-"))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe("private durable state and redacted audit", () => {
  it("writes state atomically with private modes and validates semantics", () => {
    const config = runtimeConfig()
    const stateFile = join(temporaryRoot(), "state", "state.json")
    const store = new FileStateStore(stateFile, config.policy.sha256, () => {})
    const state = createInitialState(config.policy.sha256)
    store.write(state)
    assert.deepEqual(store.read(), state)
    assert.equal(statSync(join(stateFile, "..")).mode & 0o777, 0o700)
    assert.equal(statSync(stateFile).mode & 0o777, 0o600)
    assert.throws(() => parseStewardState({
      ...state,
      pending: {
        phase: "outcome_received",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        preparedAt: "2030-01-01T00:00:00.000Z",
        workReference: "RYA-1"
      }
    }, config.policy.sha256), /state-invalid/)
  })

  it("refuses symlinked state files", () => {
    const config = runtimeConfig()
    const root = temporaryRoot()
    const target = join(root, "target.json")
    const stateFile = join(root, "state.json")
    const targetStore = new FileStateStore(target, config.policy.sha256, () => {})
    targetStore.write(createInitialState(config.policy.sha256))
    symlinkSync(target, stateFile)
    const store = new FileStateStore(stateFile, config.policy.sha256, () => {})
    assert.throws(() => store.read(), /state-file-untrusted/)
  })

  it("serializes only allowlisted audit fields without usage or credential material", () => {
    const config = runtimeConfig()
    const auditFile = join(temporaryRoot(), "audit", "audit.jsonl")
    const log = new AuditLog(auditFile, () => {})
    const record = buildAuditRecord({
      timestamp: "2030-01-01T00:00:00.000Z",
      policyVersion: config.policy.config.policyVersion,
      policySha256: config.policy.sha256,
      codeVersion: "fixture",
      mode: "dry-run",
      decision: {
        consume: false,
        reasons: ["evidence_missing"],
        workReference: null,
        creditAvailability: "unknown",
        exhaustedEligibleBucket: false
      },
      result: "dry_run"
    })
    log.append(record)
    const serialized = readFileSync(auditFile, "utf8")
    assert.equal(statSync(auditFile).mode & 0o777, 0o600)
    for (const prohibited of [
      "usedPercent", "resetsAt", "creditId", "availableCount",
      "accessToken", "rawError", "EXAMPLE_CREDENTIAL_VALUE"
    ]) assert.equal(serialized.includes(prohibited), false)
  })
})

describe("clock stability", () => {
  const previous = {
    bootId: "boot-a",
    wallClockMs: 10_000,
    monotonicMs: 5_000
  }

  it("accepts synchronized monotonic progress and a synchronized new boot", () => {
    assert.equal(evaluateClockStability(previous, {
      bootId: "boot-a",
      wallClockMs: 20_000,
      monotonicMs: 15_000
    }, true, 120), true)
    assert.equal(evaluateClockStability(previous, {
      bootId: "boot-b",
      wallClockMs: 1_000,
      monotonicMs: 10
    }, true, 120), true)
  })

  it("rejects unsynchronized, rolled-back, and skewed clocks", () => {
    assert.equal(evaluateClockStability(previous, {
      bootId: "boot-a",
      wallClockMs: 20_000,
      monotonicMs: 15_000
    }, false, 120), false)
    assert.equal(evaluateClockStability(previous, {
      bootId: "boot-a",
      wallClockMs: 9_000,
      monotonicMs: 6_000
    }, true, 120), false)
    assert.equal(evaluateClockStability(previous, {
      bootId: "boot-a",
      wallClockMs: 200_000,
      monotonicMs: 6_000
    }, true, 120), false)
  })
})
