import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  buildCodexReadinessArgs,
  checkCodexReadiness
} from "../dist/codex/readiness.js"
import { reportReadinessFailure } from "../dist/codex/readiness-comment.js"

test("successful readiness requires the exact marker without tool activity", async () => {
  const fixture = createProbeFixture([
    jsonEvent({ type: "thread.started", thread_id: "thread-1" }),
    jsonEvent({ type: "turn.started" }),
    jsonEvent({
      type: "item.completed",
      item: { id: "item-1", type: "agent_message", text: "CODEX_AUTH_READY" }
    }),
    jsonEvent({ type: "turn.completed", usage: {} })
  ])

  try {
    const result = await checkCodexReadiness({
      codexBin: fixture.bin,
      model: "test-model"
    })

    assert.deepEqual(result, { ready: true, code: "ready" })
  } finally {
    fixture.cleanup()
  }
})

test("readiness closes probe stdin instead of leaving Codex waiting for appended input", async () => {
  const fixture = createProbeFixture([
    jsonEvent({
      type: "item.completed",
      item: { id: "item-1", type: "agent_message", text: "CODEX_AUTH_READY" }
    }),
    jsonEvent({ type: "turn.completed", usage: {} })
  ], 0, ["IFS= read -r -t 1 _ && exit 9"])
  const startedAt = performance.now()

  try {
    const result = await checkCodexReadiness({
      codexBin: fixture.bin,
      model: "test-model"
    })

    assert.deepEqual(result, { ready: true, code: "ready" })
    assert.ok(performance.now() - startedAt < 500, "probe waited for stdin instead of observing EOF")
  } finally {
    fixture.cleanup()
  }
})

test("readiness classifies a structured immediate 401 without returning raw output", async () => {
  const fixture = createProbeFixture(
    [jsonEvent({ type: "error", message: "unexpected status 401 Unauthorized: request rejected" })],
    1
  )

  try {
    const result = await checkCodexReadiness({
      codexBin: fixture.bin,
      model: "test-model"
    })

    assert.deepEqual(result, { ready: false, code: "authentication-failed" })
    assert.doesNotMatch(JSON.stringify(result), /request rejected|401|Unauthorized/)
  } finally {
    fixture.cleanup()
  }
})

test("readiness keeps an unclassified runtime failure ambiguous", async () => {
  const fixture = createProbeFixture(
    [jsonEvent({ type: "error", message: "runtime stopped for an unclassified reason" })],
    1
  )

  try {
    const result = await checkCodexReadiness({
      codexBin: fixture.bin,
      model: "test-model"
    })

    assert.deepEqual(result, { ready: false, code: "probe-process-failed" })
    assert.doesNotMatch(JSON.stringify(result), /unclassified reason/)
  } finally {
    fixture.cleanup()
  }
})

test("readiness refuses a marker when structured output shows tool activity", async () => {
  const fixture = createProbeFixture([
    jsonEvent({
      type: "item.started",
      item: { id: "item-1", type: "command_execution", command: "pwd" }
    }),
    jsonEvent({
      type: "item.completed",
      item: { id: "item-2", type: "agent_message", text: "CODEX_AUTH_READY" }
    }),
    jsonEvent({ type: "turn.completed", usage: {} })
  ])

  try {
    const result = await checkCodexReadiness({
      codexBin: fixture.bin,
      model: "test-model"
    })

    assert.deepEqual(result, { ready: false, code: "probe-activity-detected" })
  } finally {
    fixture.cleanup()
  }
})

test("generated readiness args force an ephemeral read-only empty-workspace probe", () => {
  const descriptor = { codexBin: "codex", model: "gpt-test" }
  const args = buildCodexReadinessArgs(descriptor, "/tmp/isolated-probe")

  assert.deepEqual(Object.keys(descriptor).sort(), ["codexBin", "model"])
  assert.deepEqual(args.slice(0, 13), [
    "exec",
    "--ephemeral",
    "--json",
    "--ignore-rules",
    "--model", "gpt-test",
    "-c", "model_reasoning_effort=\"low\"",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "--cd", "/tmp/isolated-probe"
  ])
  assert.match(args.at(-1), /Do not use tools/)
  assert.match(args.at(-1), /Reply with exactly CODEX_AUTH_READY/)
})

test("readiness failure comments are deduplicated by result code and agent signature", async () => {
  const comments = []
  const issue = {
    id: "issue-1",
    comments: {
      nodes: [{
        body: "Codex execution readiness check (work, authentication-failed):\n\nAlready reported.\n\n— daedalus."
      }]
    }
  }

  await reportReadinessFailure(
    {
      agentId: "daedalus",
      readyStatus: "Waiting For Agent",
      reviewReadyStatus: "In Review"
    },
    {
      getIssue: async () => {
        throw new Error("detailed issue should not be refetched")
      },
      createComment: async (_issueId, body) => comments.push(body)
    },
    issue,
    { ready: false, code: "authentication-failed" },
    "work"
  )

  assert.deepEqual(comments, [])
})

function createProbeFixture(events, exitCode = 0, prelude = []) {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-readiness-fixture-"))
  const bin = join(root, "fake-codex")
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    ...prelude,
    ...events.map((event) => `printf '%s\\n' '${event}'`),
    `exit ${exitCode}`
  ]
  writeFileSync(bin, lines.join("\n"))
  chmodSync(bin, 0o700)

  return {
    bin,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

const jsonEvent = (event) => JSON.stringify(event)
