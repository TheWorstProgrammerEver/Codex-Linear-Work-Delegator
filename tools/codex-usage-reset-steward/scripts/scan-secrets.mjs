import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

const patterns = [
  { code: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    code: "credential-assignment",
    pattern: /\b(?:api[_-]?key|password|secret|token)\b\s*[:=]\s*["'][^"'\n]{12,}["']/i
  },
  { code: "credential-url", pattern: /https?:\/\/[^/\s:@]+:[^@\s]+@/ },
  { code: "private-home", pattern: /\/home\/daedalus\// }
]

const scan = (text) => patterns.flatMap(({ code, pattern }) => pattern.test(text) ? [code] : [])

const privateKeyControl = ["-----BEGIN", "PRIVATE KEY-----"].join(" ")
if (!scan(privateKeyControl).includes("private-key")) {
  throw new Error("secret scanner negative control failed")
}
if (scan("token_reference = system-keyring-entry").length !== 0) {
  throw new Error("secret scanner allowed control failed")
}

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" }
).split(/\r?\n/).filter(Boolean).filter((path) =>
  !path.startsWith("node_modules/")
  && !path.startsWith("dist/")
  && !path.endsWith("package-lock.json")
  && existsSync(path)
)

const findings = files.flatMap((path) =>
  scan(readFileSync(path, "utf8")).map((code) => `${path}:${code}`)
)

if (findings.length > 0) {
  console.error(`secret-scan-failed count=${findings.length}`)
  process.exitCode = 1
} else {
  console.log(`secret-scan-passed files=${files.length}`)
}
