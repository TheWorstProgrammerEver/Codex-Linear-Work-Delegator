import { existsSync, readFileSync } from "node:fs"
import type { EnvMap } from "./types.js"

export function mergeEnvFile(target: EnvMap, filePath: string, requiredFile: boolean): void {
  if (!existsSync(filePath)) {
    if (requiredFile) throw new Error(`Env file does not exist: ${filePath}`)
    return
  }

  Object.assign(target, parseEnvContent(readFileSync(filePath, "utf8")))
}

const parseEnvContent = (content: string): EnvMap =>
  Object.fromEntries(content.split(/\r?\n/).map(parseEnvLine).filter(isEntry))

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  const equalsIndex = trimmed.indexOf("=")
  if (equalsIndex === -1) return null

  return [
    trimmed.slice(0, equalsIndex).trim(),
    unquote(trimmed.slice(equalsIndex + 1).trim())
  ]
}

const isEntry = (entry: [string, string] | null): entry is [string, string] =>
  entry !== null

const unquote = (input: string): string =>
  isQuoted(input) ? input.slice(1, -1) : input

const isQuoted = (input: string): boolean =>
  (input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))
