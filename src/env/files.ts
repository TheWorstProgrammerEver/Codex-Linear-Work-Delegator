import { existsSync, readFileSync } from "node:fs";
import type { EnvMap } from "./types.js";

export function mergeEnvFile(target: EnvMap, filePath: string, requiredFile: boolean): void {
  if (!existsSync(filePath)) {
    if (requiredFile) throw new Error(`Env file does not exist: ${filePath}`);
    return;
  }

  Object.assign(target, parseEnvContent(readFileSync(filePath, "utf8")));
}

function parseEnvContent(content: string): EnvMap {
  return Object.fromEntries(content.split(/\r?\n/).map(parseEnvLine).filter(isEntry));
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const equalsIndex = trimmed.indexOf("=");
  if (equalsIndex === -1) return null;

  return [
    trimmed.slice(0, equalsIndex).trim(),
    unquote(trimmed.slice(equalsIndex + 1).trim())
  ];
}

function isEntry(entry: [string, string] | null): entry is [string, string] {
  return entry !== null;
}

function unquote(input: string): string {
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    return input.slice(1, -1);
  }

  return input;
}
