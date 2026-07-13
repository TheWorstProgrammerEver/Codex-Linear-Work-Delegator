#!/usr/bin/env node
import { runReviewCli } from "./cli/run-review.js"

try {
  await runReviewCli(process.argv.slice(2), process.cwd())
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}
