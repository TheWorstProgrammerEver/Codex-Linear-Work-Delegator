import assert from "node:assert/strict"
import test from "node:test"

import { buildPrompt } from "../dist/codex/prompt.js"

test("generated prompt requires PR artifact for code-changing issues", () => {
  const prompt = buildPrompt(baseConfig(), linearIssue())

  assert.match(prompt, /### Code-Change Completion Contract/)
  assert.match(prompt, /dedicated issue branch or an existing issue branch/)
  assert.match(prompt, /committed locally with a clear commit message/)
  assert.match(prompt, /branch is pushed to the remote/)
  assert.match(prompt, /pull request is opened or updated/)
  assert.match(prompt, /completion comment includes the PR URL/)
  assert.match(prompt, /local-only, no-PR, notes-only, research-only/)
  assert.match(prompt, /agent:model:gpt-5\.3-codex-spark/)
  assert.match(prompt, /do not relax the branch, commit, push, PR/)
})

test("generated prompt surfaces GitHub App auth diagnostics", () => {
  const prompt = buildPrompt(baseConfig(), linearIssue())

  assert.match(
    prompt,
    /\/home\/daedalus\/codex-notes\/runbooks\/github-app-pr-workflow\.md/
  )
  assert.match(prompt, /codex-github-token --expires-at/)
  assert.match(prompt, /CODEX_GH_REPO=OWNER\/REPO codex-gh/)
  assert.match(
    prompt,
    /GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=\/home\/daedalus\/\.local\/bin\/codex-github-askpass git push/
  )
  assert.match(prompt, /If an authenticated push returns `403`/)
  assert.match(prompt, /installation repository list/)
  assert.match(prompt, /git push --dry-run origin HEAD:refs\/heads\/codex-auth-dry-run/)
})

const baseConfig = (overrides = {}) => ({
  linearApiKey: "test-key",
  linearApiUrl: "https://linear.example/graphql",
  agentId: "daedalus",
  agentLabels: ["agent:daedalus", "agent:any"],
  readyStatus: "Waiting For Agent",
  runningStatus: "Agent In Progress",
  blockedStatus: "Blocked",
  reviewStatus: "In Review",
  defaultModel: "gpt-5.5",
  defaultSandbox: "danger-full-access",
  codexBin: "codex",
  codexCwd: process.cwd(),
  codexExecMode: "attached",
  codexExtraArgs: [],
  stateDir: "/tmp/codex-linear-test-unused-state",
  waitTimeoutMs: 60_000,
  lockStaleMs: 600_000,
  fetchLimit: 50,
  dryRun: false,
  noSpawn: false,
  ...overrides
})

const linearIssue = () => ({
  id: "issue-29",
  identifier: "RYA-29",
  title: "Update prompt completion contract",
  url: "https://linear.app/example/RYA-29",
  description: "Change repository files so spawned Codex workers require PRs.",
  priority: 2,
  priorityLabel: "High",
  createdAt: "2026-07-02T07:00:00.000Z",
  updatedAt: "2026-07-02T07:30:00.000Z",
  state: { id: "state-1", name: "Agent In Progress", type: "started" },
  labels: {
    nodes: [
      {
        id: "label-1",
        name: "daedalus",
        parent: { id: "agent", name: "agent" }
      },
      {
        id: "label-2",
        name: "gpt-5.3-codex-spark",
        parent: { id: "agent-model", name: "agent:model" }
      }
    ]
  },
  comments: { nodes: [] },
  team: { id: "team-1", key: "RYA", name: "Ryan Hayward" }
})
