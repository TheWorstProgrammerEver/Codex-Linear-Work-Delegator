#!/usr/bin/env node
import { runCli } from "./cli/run.js";

try {
  await runCli(process.argv.slice(2), process.cwd());
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
