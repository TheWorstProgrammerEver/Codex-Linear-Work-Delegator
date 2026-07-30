import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { parseRateLimitsResponse } from "../src/app-server/rate-limits.js"
import { parseBlockedWorkEvidence } from "../src/evidence/blocked-work.js"
import { parsePolicy } from "../src/policy/policy-config.js"
import { evidence, rateLimits, runtimeConfig } from "./fixtures.js"

describe("runtime boundaries", () => {
  it("accepts the installed app-server rate-limit shape", () => {
    assert.deepEqual(parseRateLimitsResponse(rateLimits()), rateLimits())
  })

  it("fails closed on unknown reached types and malformed reset credits", () => {
    assert.throws(() => parseRateLimitsResponse({
      ...rateLimits(),
      rateLimits: { ...rateLimits().rateLimits, rateLimitReachedType: "new_limit_kind" }
    }), /rate-limits-schema-drift/)
    assert.throws(() => parseRateLimitsResponse({
      ...rateLimits(),
      rateLimitResetCredits: { availableCount: 1, credits: [{ id: "opaque" }] }
    }), /rate-limits-invalid/)
  })

  it("accepts only structured, eligible, unblocked work evidence", () => {
    assert.deepEqual(parseBlockedWorkEvidence(evidence()), evidence())
    assert.throws(() => parseBlockedWorkEvidence({
      ...evidence(),
      classifier: "textMatch"
    }), /evidence-invalid/)
    assert.throws(() => parseBlockedWorkEvidence({
      ...evidence(),
      work: { ...evidence().work, blockedBy: ["RYA-1"] }
    }), /evidence-invalid/)
    assert.throws(() => parseBlockedWorkEvidence({
      ...evidence(),
      rawError: "should never be accepted"
    }), /evidence-invalid/)
  })

  it("rejects policy drift and non-dry source defaults", () => {
    const policy = runtimeConfig().policy.config
    assert.deepEqual(parsePolicy(policy), policy)
    assert.throws(() => parsePolicy({ ...policy, sourceDefaultMode: "consume" }), /policy-invalid/)
    assert.throws(() => parsePolicy({ ...policy, bypass: true }), /policy-unknown-field/)
  })

  it("grants app-server writes to the designated service user's Codex home", () => {
    const unit = readFileSync(
      new URL("../systemd/codex-usage-reset-steward.service", import.meta.url),
      "utf8"
    )
    assert.match(unit, /^User=daedalus$/m)
    assert.match(
      unit,
      /^ReadWritePaths=\/etc\/codex-usage-reset-steward\/codex-home$/m
    )
    assert.doesNotMatch(unit, /^ReadWritePaths=%h\//m)
  })
})
