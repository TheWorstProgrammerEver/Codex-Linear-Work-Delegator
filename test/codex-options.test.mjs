import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  buildCodexArgs,
  getCodexLaunchOptions,
  InvalidCodexLaunchOptionsError
} from "../dist/codex/options.js"

test("no speed label leaves Codex speed config untouched", () => {
  const options = getCodexLaunchOptions(baseConfig(), linearIssue())
  const args = buildCodexArgs(baseConfig(), options, "prompt")

  assert.equal(options.speed, undefined)
  assert.doesNotMatch(args.join("\n"), /fast_mode/)
  assert.doesNotMatch(args.join("\n"), /service_tier/)
})

test("fast speed label enables Fast mode service tier", () => {
  const options = getCodexLaunchOptions(baseConfig(), linearIssue({
    labels: [agentLabel("speed:fast")]
  }))
  const args = buildCodexArgs(baseConfig(), options, "prompt")

  assert.equal(options.speed, "fast")
  assert.deepEqual(speedSlice(args), ["--enable", "fast_mode", "-c", "service_tier=\"fast\""])
})

test("standard speed label disables inherited Fast mode", () => {
  const options = getCodexLaunchOptions(baseConfig(), linearIssue({
    labels: [agentLabel("speed:standard")]
  }))
  const args = buildCodexArgs(baseConfig(), options, "prompt")

  assert.equal(options.speed, "standard")
  assert.deepEqual(speedSlice(args), ["--disable", "fast_mode"])
  assert.equal(args.includes("service_tier=\"fast\""), false)
})

test("conflicting speed labels are rejected before spawn", () => {
  assert.throws(
    () => getCodexLaunchOptions(baseConfig(), linearIssue({
      labels: [agentLabel("speed:fast"), agentLabel("speed:standard")]
    })),
    InvalidCodexLaunchOptionsError
  )
})

test("fast speed label rejects unsupported model", () => {
  assert.throws(
    () => getCodexLaunchOptions(baseConfig(), linearIssue({
      labels: [agentLabel("model:gpt-5.3-codex-spark"), agentLabel("speed:fast")]
    })),
    /does not support Codex Fast mode/
  )
})

const speedSlice = (args) => {
  const enableIndex = args.indexOf("--enable")
  if (enableIndex >= 0) return args.slice(enableIndex, enableIndex + 4)

  const disableIndex = args.indexOf("--disable")
  if (disableIndex >= 0) return args.slice(disableIndex, disableIndex + 2)

  return []
}

const baseConfig = (overrides = {}) => ({
  linearApiKey: "test-key",
  linearApiUrl: "https://linear.example/graphql",
  agentId: "daedalus",
  agentLabels: ["agent:daedalus", "agent:any"],
  reviewerLabels: ["reviewer:daedalus", "reviewer:any"],
  readyStatus: "Waiting For Agent",
  runningStatus: "Agent In Progress",
  blockedStatus: "Blocked",
  reviewStatus: "In Review",
  reviewReadyStatus: "In Review",
  reviewRunningStatus: "Agent Reviewing",
  reviewPassedStatus: "Review Passed",
  reviewReturnStatus: "Waiting For Agent",
  defaultModel: "gpt-5.5",
  defaultSandbox: "danger-full-access",
  codexBin: "codex",
  codexCwd: process.cwd(),
  codexExecMode: "attached",
  codexExtraArgs: [],
  stateDir: join(tmpdir(), "codex-linear-test-unused-state"),
  waitTimeoutMs: 60_000,
  lockStaleMs: 600_000,
  fetchLimit: 50,
  dryRun: false,
  noSpawn: false,
  advise: false,
  ...overrides
})

const linearIssue = ({ labels = [] } = {}) => ({
  id: "issue-1",
  identifier: "RYA-1",
  title: "Test issue",
  url: "https://linear.app/example/RYA-1",
  description: "Test work",
  priority: 2,
  createdAt: "2026-06-29T09:00:00.000Z",
  updatedAt: "2026-06-29T09:00:00.000Z",
  state: { id: "state-1", name: "Agent In Progress" },
  labels: { nodes: labels },
  comments: { nodes: [] },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" }
})

const agentLabel = (name) => ({
  id: `agent-${name}`,
  name,
  parent: { id: "agent", name: "agent" }
})
