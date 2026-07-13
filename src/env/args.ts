import type { CliOptions } from "./types.js"

const BOOLEAN_FLAGS = new Set(["advise", "dry-run", "no-spawn", "help"])

export const parseArgs = (argv: string[]): CliOptions =>
  parseArgTokens(argv, { envFiles: [], flags: {} })

function parseArgTokens(argv: string[], options: CliOptions, index = 0): CliOptions {
  if (index >= argv.length) return options

  const arg = argv[index]
  if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`)

  const [name, inlineValue] = arg.slice(2).split("=", 2).map((part) => part.trim())
  if (BOOLEAN_FLAGS.has(name)) {
    options.flags[name] = true
    return parseArgTokens(argv, options, index + 1)
  }

  const value = inlineValue ?? argv[index + 1]
  const nextIndex = inlineValue === undefined ? index + 2 : index + 1
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`)

  if (name === "env-file") options.envFiles.push(value)
  else options.flags[name] = value

  return parseArgTokens(argv, options, nextIndex)
}
