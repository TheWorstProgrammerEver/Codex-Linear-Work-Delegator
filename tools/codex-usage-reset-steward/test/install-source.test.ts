import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it } from "node:test"

it("builds the install release from the reviewed Git tree, not ignored dist output", () => {
  const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  const poison = join(packageRoot, "dist", "ignored-poison-marker")
  const temporaryRoot = mkdtempSync(join(tmpdir(), "codex-reset-reviewed-build-"))
  const output = join(temporaryRoot, "source")
  mkdirSync(dirname(poison), { recursive: true })
  writeFileSync(poison, "unreviewed-output-must-not-ship\n")
  try {
    const treeish = execFileSync("git", ["write-tree"], {
      cwd: packageRoot,
      encoding: "utf8"
    }).trim()
    const result = spawnSync(
      "bash",
      ["scripts/build-reviewed-release.sh", output, treeish],
      { cwd: packageRoot, encoding: "utf8", timeout: 30_000, maxBuffer: 1_048_576 }
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(existsSync(join(output, "dist", "ignored-poison-marker")), false)
    assert.equal(existsSync(join(output, "dist", "src", "cli.js")), true)
  } finally {
    rmSync(poison, { force: true })
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
