import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { runSteward } from "../src/runtime/runner.js"
import { createInitialState } from "../src/state/steward-state.js"
import { evidence, NOW, rateLimits, runtimeConfig } from "./fixtures.js"
import type { AppServer } from "../src/app-server/client.js"
import type { AuditRecord } from "../src/audit/audit-log.js"
import type { ClockSource } from "../src/clock/stable-clock.js"
import type { RunDependencies } from "../src/runtime/runner.js"
import type { ConsumeOutcome, StateStore, StewardState } from "../src/state/steward-state.js"

class MemoryStateStore implements StateStore {
  state: StewardState
  writes: StewardState[] = []

  constructor(state: StewardState) {
    this.state = structuredClone(state)
  }

  read(): StewardState {
    return structuredClone(this.state)
  }

  write(state: StewardState): void {
    this.state = structuredClone(state)
    this.writes.push(structuredClone(state))
  }
}

class FakeAppServer implements AppServer {
  reads = 0
  consumeKeys: string[] = []
  closed = 0
  readonly #outcomes: Array<ConsumeOutcome | Error>

  constructor(...outcomes: Array<ConsumeOutcome | Error>) {
    this.#outcomes = outcomes
  }

  async readRateLimits() {
    this.reads += 1
    return rateLimits()
  }

  async consumeReset(key: string): Promise<ConsumeOutcome> {
    this.consumeKeys.push(key)
    const outcome = this.#outcomes.shift() ?? "reset"
    if (outcome instanceof Error) throw outcome
    return outcome
  }

  async close(): Promise<void> {
    this.closed += 1
  }
}

const stableClock: ClockSource = {
  check: () => ({
    stable: true,
    observation: { bootId: "fixture-boot", wallClockMs: NOW.getTime(), monotonicMs: 10_000 }
  })
}

function dependencies(
  store: MemoryStateStore,
  app: FakeAppServer,
  overrides: Partial<RunDependencies> = {}
): RunDependencies & { records: AuditRecord[] } {
  const records: AuditRecord[] = []
  return {
    appServer: app,
    stateStore: store,
    auditLog: { append: (record) => records.push(record) },
    clock: stableClock,
    readEvidence: () => evidence(),
    killSwitchActive: () => false,
    now: () => NOW,
    records,
    ...overrides
  }
}

const initialStore = () => {
  const config = runtimeConfig()
  return new MemoryStateStore(createInitialState(config.policy.sha256))
}

describe("crash-safe steward orchestration", () => {
  it("never invokes consume in dry-run", async () => {
    const config = runtimeConfig({ mode: "dry-run" })
    const store = initialStore()
    const app = new FakeAppServer()
    const deps = dependencies(store, app)
    const result = await runSteward(config, deps)
    assert.equal(result.result, "dry_run")
    assert.equal(result.decision.consume, true)
    assert.equal(app.consumeKeys.length, 0)
    assert.equal(app.reads, 1)
  })

  for (const outcome of ["reset", "alreadyRedeemed", "nothingToReset", "noCredit"] as const) {
    it(`classifies and finalizes ${outcome}`, async () => {
      const config = runtimeConfig()
      const store = initialStore()
      const app = new FakeAppServer(outcome)
      const deps = dependencies(store, app)
      const result = await runSteward(config, deps)
      assert.equal(store.state.pending, null)
      assert.equal(app.consumeKeys.length, 1)
      assert.equal(
        app.reads,
        outcome === "reset" || outcome === "alreadyRedeemed" ? 3 : 2
      )
      assert.equal(store.state.lastConsumedAt !== null, outcome === "reset" || outcome === "alreadyRedeemed")
      assert.equal(deps.records.at(-1)?.result, result.result)
    })
  }

  it("reuses the exact idempotency key after an ambiguous transport failure", async () => {
    const config = runtimeConfig()
    const store = initialStore()
    const firstApp = new FakeAppServer(new Error("fixture-private-transport-detail"))
    const first = dependencies(store, firstApp)
    assert.equal((await runSteward(config, first)).result, "ambiguous_transport")
    const pendingKey = store.state.pending?.idempotencyKey
    assert.ok(pendingKey)
    assert.equal(store.state.pending?.phase, "dispatched")

    const retryApp = new FakeAppServer("alreadyRedeemed")
    const retry = dependencies(store, retryApp)
    assert.equal((await runSteward(config, retry)).result, "already_redeemed")
    assert.deepEqual(retryApp.consumeKeys, [pendingKey])
    assert.equal(store.state.pending, null)
    assert.equal(JSON.stringify(retry.records).includes("fixture-private-transport-detail"), false)
  })

  it("recovers a crash after prepare with the persisted key", async () => {
    const config = runtimeConfig()
    const store = initialStore()
    const crashing = dependencies(store, new FakeAppServer(), {
      fault: (point) => {
        if (point === "after_prepare") throw new Error("synthetic-crash")
      }
    })
    await assert.rejects(runSteward(config, crashing), /synthetic-crash/)
    const pendingKey = store.state.pending?.idempotencyKey
    assert.equal(store.state.pending?.phase, "prepared")

    const recoveredApp = new FakeAppServer("nothingToReset")
    await runSteward(config, dependencies(store, recoveredApp))
    assert.deepEqual(recoveredApp.consumeKeys, [pendingKey])
    assert.equal(store.state.pending, null)
  })

  it("recovers a crash after outcome without consuming again", async () => {
    const config = runtimeConfig()
    const store = initialStore()
    const crashingApp = new FakeAppServer("reset")
    const crashing = dependencies(store, crashingApp, {
      fault: (point) => {
        if (point === "after_outcome") throw new Error("synthetic-crash")
      }
    })
    await assert.rejects(runSteward(config, crashing), /synthetic-crash/)
    assert.equal(store.state.pending?.phase, "outcome_received")

    const recoveredApp = new FakeAppServer()
    assert.equal((await runSteward(config, dependencies(store, recoveredApp))).result, "reset")
    assert.equal(recoveredApp.consumeKeys.length, 0)
    assert.equal(recoveredApp.reads, 1)
  })

  it("fails closed on clock anomalies and preserves pending under the kill switch", async () => {
    const config = runtimeConfig()
    const store = initialStore()
    const app = new FakeAppServer()
    const unstable = dependencies(store, app, {
      clock: {
        check: () => ({
          stable: false,
          observation: { bootId: "fixture-boot", wallClockMs: NOW.getTime() - 1, monotonicMs: 5_000 }
        })
      }
    })
    const blocked = await runSteward(config, unstable)
    assert.equal(blocked.decision.consume, false)
    assert.ok(blocked.decision.reasons.includes("clock_unstable"))
    assert.equal(app.consumeKeys.length, 0)

    store.state.pending = {
      phase: "dispatched",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      preparedAt: NOW.toISOString(),
      workReference: "RYA-999"
    }
    const killedApp = new FakeAppServer()
    const killed = dependencies(store, killedApp, { killSwitchActive: () => true })
    assert.equal((await runSteward(config, killed)).result, "policy_blocked")
    assert.equal(killedApp.consumeKeys.length, 0)
    assert.notEqual(store.state.pending, null)
  })
})
