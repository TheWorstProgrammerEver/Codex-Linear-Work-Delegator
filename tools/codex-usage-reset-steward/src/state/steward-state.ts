import { randomUUID } from "node:crypto"
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs"
import { dirname, join } from "node:path"
import { parseStewardState } from "./state-schema.js"
import type { PendingAttempt, StewardState } from "./state-schema.js"

export { parseStewardState } from "./state-schema.js"
export type {
  ClockObservation,
  ConsumeOutcome,
  PendingAttempt,
  StewardState
} from "./state-schema.js"

export interface StateStore {
  read(): StewardState
  write(state: StewardState): void
}

export function createInitialState(policySha256: string): StewardState {
  return {
    schemaVersion: 1,
    policySha256,
    lastConsumedAt: null,
    clockObservation: null,
    pending: null
  }
}

export function createPendingAttempt(now: Date, workReference: string): PendingAttempt {
  return {
    phase: "prepared",
    idempotencyKey: randomUUID(),
    preparedAt: now.toISOString(),
    workReference
  }
}

export class FileStateStore implements StateStore {
  readonly #path: string
  readonly #policySha256: string
  readonly #validateDirectory: (path: string) => void

  constructor(
    path: string,
    policySha256: string,
    validateDirectory = validateTrustedDirectory
  ) {
    this.#path = path
    this.#policySha256 = policySha256
    this.#validateDirectory = validateDirectory
  }

  read(): StewardState {
    const directory = dirname(this.#path)
    preparePrivateDirectory(directory, this.#validateDirectory)
    if (!existsSync(this.#path)) return createInitialState(this.#policySha256)
    validatePrivateFile(this.#path)
    return parseStewardState(JSON.parse(readFileSync(this.#path, "utf8")), this.#policySha256)
  }

  write(state: StewardState): void {
    parseStewardState(state, this.#policySha256)
    const directory = dirname(this.#path)
    preparePrivateDirectory(directory, this.#validateDirectory)
    const temporary = join(directory, `.state-${randomUUID()}.tmp`)
    try {
      const descriptor = openSync(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      )
      try {
        writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      renameSync(temporary, this.#path)
      syncDirectory(directory)
    } catch (error) {
      if (existsSync(temporary)) {
        unlinkSync(temporary)
        syncDirectory(directory)
      }
      throw error
    }
  }
}

export function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: false, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("state-directory-untrusted")
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("state-directory-untrusted")
  }
}

export function preparePrivateDirectory(
  path: string,
  validateDirectory = validateTrustedDirectory
): void {
  if (!existsSync(path)) {
    validateDirectory(dirname(path))
    mkdirSync(path, { recursive: false, mode: 0o700 })
  }
  validateDirectory(path)
  ensurePrivateDirectory(path)
}

export function validateTrustedDirectory(path: string): void {
  const components = path.split("/").filter(Boolean)
  let current = "/"
  for (const component of components) {
    current = join(current, component)
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("state-directory-untrusted")
    const trustedOwner = stat.uid === 0 || stat.uid === process.getuid?.()
    if (!trustedOwner || (stat.mode & 0o022) !== 0) throw new Error("state-directory-untrusted")
  }
}

function validatePrivateFile(path: string): void {
  const stat = lstatSync(path)
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.uid !== process.getuid?.()
    || (stat.mode & 0o077) !== 0
    || stat.nlink !== 1
  ) throw new Error("state-file-untrusted")
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(descriptor)
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error("state-file-untrusted")
  } finally {
    closeSync(descriptor)
  }
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
