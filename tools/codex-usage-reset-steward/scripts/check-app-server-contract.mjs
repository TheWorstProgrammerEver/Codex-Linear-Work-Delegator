import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "codex-reset-contract-"))

try {
  execFileSync(
    process.env.CODEX_RESET_STEWARD_CODEX_BIN ?? "codex",
    ["app-server", "generate-json-schema", "--out", root],
    { stdio: "ignore", timeout: 30_000 }
  )
  const bundle = JSON.parse(readFileSync(
    join(root, "codex_app_server_protocol.v2.schemas.json"),
    "utf8"
  ))
  const serializedBundle = JSON.stringify(bundle)
  const definitions = bundle.definitions
  const required = definitions.ConsumeAccountRateLimitResetCreditParams.required
  const outcomes = definitions.ConsumeAccountRateLimitResetCreditOutcome.oneOf
    .flatMap((entry) => entry.enum ?? [])
    .sort()
  const errorVariants = definitions.CodexErrorInfo.oneOf
    .flatMap((entry) => entry.enum ?? [])

  assert(required.length === 1 && required[0] === "idempotencyKey")
  assert(JSON.stringify(outcomes) === JSON.stringify([
    "alreadyRedeemed", "noCredit", "nothingToReset", "reset"
  ]))
  assert(errorVariants.includes("usageLimitExceeded"))
  assert(serializedBundle.includes("\"thread/read\""))
  assert(definitions.ThreadReadParams.required.includes("threadId"))
  assert(definitions.ThreadReadParams.properties.includeTurns.type === "boolean")
  assert(definitions.ThreadReadResponse.required.includes("thread"))
  assert(definitions.Turn.properties.error !== undefined)
  assert(definitions.TurnError.properties.codexErrorInfo !== undefined)
  assert(definitions.RateLimitResetCreditsSummary.required.includes("availableCount"))
  assert(definitions.GetAccountRateLimitsResponse.required.includes("rateLimits"))
  assert(definitions.RateLimitWindow.required.includes("usedPercent"))
  console.log("app-server-contract-passed")
} finally {
  rmSync(root, { recursive: true, force: true })
}

function assert(condition) {
  if (!condition) throw new Error("app-server-contract-drift")
}
