import type { spawn } from "node:child_process";
import { clearCurrentState } from "../state.js";
import type { Config } from "../env/types.js";

type ChildProcess = ReturnType<typeof spawn>;
type WaitResult = "exit" | "timeout";

export async function waitForChildOrTimeout(config: Config, pid: number, child: ChildProcess): Promise<void> {
  if (config.waitTimeoutMs === 0) {
    child.unref();
    return;
  }

  if (await waitForExitOrTimeout(config.waitTimeoutMs, child) === "exit") {
    clearCurrentState(config, pid);
    console.log(`Codex child pid=${pid} exited before wait timeout.`);
    return;
  }

  child.unref();
  console.log(`Codex child pid=${pid} is still running after wait timeout; leaving state for next scheduler run.`);
}

function waitForExitOrTimeout(timeoutMs: number, child: ChildProcess): Promise<WaitResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("timeout"), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve("exit");
    });
  });
}
