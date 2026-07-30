import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { evaluatePolicy } from "../src/policy/evaluate.js"
import { evidence, NOW, rateLimits, runtimeConfig } from "./fixtures.js"

const policy = runtimeConfig().policy.config

const baseInput = () => ({
  nowMs: NOW.getTime(),
  mode: "consume" as const,
  configuredOwner: "daedalus",
  policyApproved: true,
  killSwitchActive: false,
  clockStable: true,
  evidence: evidence(),
  rateLimits: rateLimits(),
  lastConsumedAt: null
})

describe("deterministic reset policy", () => {
  it("authorizes only the fully eligible conservative scenario", () => {
    assert.deepEqual(evaluatePolicy(policy, baseInput()), {
      consume: true,
      reasons: [],
      workReference: "RYA-999",
      creditAvailability: "available",
      exhaustedEligibleBucket: true
    })
  })

  it("blocks missing, stale, future, unrelated-agent, and wrong-limit evidence", () => {
    const cases = [
      { patch: { evidence: null }, reason: "evidence_missing" },
      {
        patch: {
          evidence: evidence({
            observedAt: new Date(NOW.getTime() - 16 * 60_000).toISOString()
          })
        },
        reason: "evidence_expired"
      },
      {
        patch: {
          evidence: evidence({
            observedAt: new Date(NOW.getTime() + 121_000).toISOString()
          })
        },
        reason: "evidence_future_dated"
      },
      { patch: { evidence: evidence({ agentId: "unrelated-agent" }) }, reason: "evidence_agent_not_allowed" },
      { patch: { evidence: evidence({ limitId: "other" }) }, reason: "evidence_limit_mismatch" }
    ]
    for (const scenario of cases) {
      const decision = evaluatePolicy(policy, { ...baseInput(), ...scenario.patch })
      assert.equal(decision.consume, false)
      assert.ok(decision.reasons.includes(scenario.reason as never))
    }
  })

  it("blocks no credit and contradictory credit details", () => {
    const noCredit = evaluatePolicy(policy, {
      ...baseInput(),
      rateLimits: rateLimits({
        rateLimitResetCredits: { availableCount: 0, credits: [] }
      })
    })
    assert.equal(noCredit.consume, false)
    assert.ok(noCredit.reasons.includes("no_eligible_credit"))

    const contradictory = evaluatePolicy(policy, {
      ...baseInput(),
      rateLimits: rateLimits({
        rateLimitResetCredits: { availableCount: 1, credits: [] }
      })
    })
    assert.equal(contradictory.consume, false)
    assert.ok(contradictory.reasons.includes("credit_details_inconsistent"))
  })

  it("blocks workspace limits, spend controls, non-exhaustion, and near resets", () => {
    const cases = [
      {
        snapshot: {
          ...rateLimits().rateLimits,
          rateLimitReachedType: "workspace_owner_credits_depleted" as const
        },
        reason: "not_ordinary_rate_limit"
      },
      {
        snapshot: { ...rateLimits().rateLimits, spendControlReached: true },
        reason: "spend_control_reached"
      },
      {
        snapshot: {
          ...rateLimits().rateLimits,
          primary: { usedPercent: 99, resetsAt: rateLimits().rateLimits.primary?.resetsAt ?? null }
        },
        reason: "limit_not_exhausted"
      },
      {
        snapshot: {
          ...rateLimits().rateLimits,
          primary: {
            usedPercent: 100,
            resetsAt: Math.floor((NOW.getTime() + 7 * 3_600_000) / 1_000)
          }
        },
        reason: "natural_reset_too_close"
      }
    ]
    for (const scenario of cases) {
      const decision = evaluatePolicy(policy, {
        ...baseInput(),
        rateLimits: rateLimits({ rateLimits: scenario.snapshot })
      })
      assert.equal(decision.consume, false)
      assert.ok(decision.reasons.includes(scenario.reason as never))
    }
  })

  it("blocks authority, timing, clock, kill switch, and frequency failures", () => {
    const cases = [
      { patch: { configuredOwner: "momus" }, reason: "owner_mismatch" },
      { patch: { policyApproved: false }, reason: "policy_digest_unapproved" },
      { patch: { killSwitchActive: true }, reason: "kill_switch_active" },
      { patch: { clockStable: false }, reason: "clock_unstable" },
      {
        patch: { nowMs: new Date("2026-07-30T05:00:00.000Z").getTime() },
        reason: "outside_unattended_window"
      },
      {
        patch: { lastConsumedAt: new Date(NOW.getTime() - 23 * 3_600_000).toISOString() },
        reason: "frequency_limited"
      }
    ]
    for (const scenario of cases) {
      const decision = evaluatePolicy(policy, { ...baseInput(), ...scenario.patch })
      assert.equal(decision.consume, false)
      assert.ok(decision.reasons.includes(scenario.reason as never))
    }
  })

  it("does not enforce the unattended window in dry-run", () => {
    const input = {
      ...baseInput(),
      mode: "dry-run" as const,
      nowMs: new Date("2026-07-30T05:00:00.000Z").getTime()
    }
    const freshForNow = evidence({
      observedAt: new Date(input.nowMs - 60_000).toISOString(),
      validUntil: new Date(input.nowMs + 60_000).toISOString()
    })
    const limitsForNow = rateLimits({
      rateLimits: {
        ...rateLimits().rateLimits,
        primary: {
          usedPercent: 100,
          resetsAt: Math.floor((input.nowMs + 9 * 3_600_000) / 1_000)
        }
      }
    })
    assert.equal(evaluatePolicy(policy, {
      ...input,
      evidence: freshForNow,
      rateLimits: limitsForNow
    }).reasons.includes("outside_unattended_window"), false)
  })
})
