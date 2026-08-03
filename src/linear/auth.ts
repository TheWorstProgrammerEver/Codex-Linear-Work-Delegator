import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { Config, LinearAuthConfig } from "../env/types.js"

interface OAuthTokenResponse {
  access_token?: unknown
  token_type?: unknown
  expires_in?: unknown
  scope?: unknown
}

interface CachedOAuthToken {
  version: 2
  clientId: string
  tokenUrl: string
  accessToken: string
  expiresAt: string
  scopes: string[]
}

interface ActiveOAuthToken {
  accessToken: string
  expiresAtMs: number
  scopes: string[]
}

export interface LinearAuthorizationProvider {
  getAuthorizationHeader(): Promise<string>
  getMcpBearerToken(): Promise<string | undefined>
  invalidate(): Promise<void>
  readonly supportsRefresh: boolean
}

export interface LinearAuthorizationDependencies {
  fetch?: typeof fetch
  now?: () => number
}

const EXPIRY_SKEW_MS = 5 * 60_000
const MAX_CACHE_BYTES = 64 * 1024

export class LinearAuthorization implements LinearAuthorizationProvider {
  readonly supportsRefresh: boolean
  readonly #auth: LinearAuthConfig
  readonly #fetch: typeof fetch
  readonly #now: () => number
  #token: ActiveOAuthToken | null = null
  #tokenRequest: Promise<ActiveOAuthToken> | null = null

  constructor(config: Pick<Config, "linearAuth">, dependencies: LinearAuthorizationDependencies = {}) {
    this.#auth = config.linearAuth
    this.#fetch = dependencies.fetch ?? fetch
    this.#now = dependencies.now ?? Date.now
    this.supportsRefresh = this.#auth.kind === "oauth-client-credentials"
  }

  async getAuthorizationHeader(): Promise<string> {
    if (this.#auth.kind === "api-key") return this.#auth.apiKey
    return `Bearer ${(await this.#getOAuthToken()).accessToken}`
  }

  async getMcpBearerToken(): Promise<string | undefined> {
    if (this.#auth.kind === "api-key") return undefined
    return (await this.#getOAuthToken()).accessToken
  }

  async invalidate(): Promise<void> {
    this.#token = null
    if (this.#auth.kind !== "oauth-client-credentials") return
    await rm(this.#auth.tokenCacheFile, { force: true })
  }

  async #getOAuthToken(): Promise<ActiveOAuthToken> {
    if (this.#auth.kind !== "oauth-client-credentials") {
      throw new Error("OAuth token requested while Linear API-key authentication is active")
    }
    if (this.#isUsable(this.#token)) return this.#token

    const cached = await this.#readCachedToken(this.#auth)
    if (this.#isUsable(cached)) {
      this.#token = cached
      return cached
    }

    if (!this.#tokenRequest) {
      this.#tokenRequest = this.#mintToken(this.#auth).finally(() => {
        this.#tokenRequest = null
      })
    }
    this.#token = await this.#tokenRequest
    return this.#token
  }

  #isUsable(token: ActiveOAuthToken | null): token is ActiveOAuthToken {
    return Boolean(
      token &&
      token.expiresAtMs - this.#now() > EXPIRY_SKEW_MS &&
      this.#requiredScopesPresent(token.scopes)
    )
  }

  #requiredScopesPresent(scopes: string[]): boolean {
    if (this.#auth.kind !== "oauth-client-credentials") return true
    const granted = new Set(scopes)
    return this.#auth.scopes.every((scope) => granted.has(scope))
  }

  async #mintToken(auth: Extract<LinearAuthConfig, { kind: "oauth-client-credentials" }>): Promise<ActiveOAuthToken> {
    const basic = Buffer.from(`${auth.clientId}:${auth.clientSecret}`, "utf8").toString("base64")
    let response: Response
    try {
      response = await this.#fetch(auth.tokenUrl, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: auth.scopes.join(",")
        })
      })
    } catch {
      throw new Error("Linear OAuth token request failed before receiving a response")
    }

    if (!response.ok) throw new Error(`Linear OAuth token request failed with HTTP ${response.status}`)

    let payload: OAuthTokenResponse
    try {
      payload = await response.json() as OAuthTokenResponse
    } catch {
      throw new Error("Linear OAuth token response was not valid JSON")
    }

    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : ""
    const tokenType = typeof payload.token_type === "string" ? payload.token_type : ""
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number.NaN
    const scopes = parseScopes(payload.scope)
    if (!accessToken || tokenType.toLowerCase() !== "bearer" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Linear OAuth token response omitted required bearer-token fields")
    }
    if (!this.#requiredScopesPresent(scopes)) {
      throw new Error("Linear OAuth token response did not grant every requested scope")
    }

    const token = {
      accessToken,
      expiresAtMs: this.#now() + expiresIn * 1000,
      scopes
    }
    await writeCachedToken(auth, token)
    return token
  }

  async #readCachedToken(
    auth: Extract<LinearAuthConfig, { kind: "oauth-client-credentials" }>
  ): Promise<ActiveOAuthToken | null> {
    let metadata
    try {
      metadata = await lstat(auth.tokenCacheFile)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null
      throw new Error(`Could not inspect Linear OAuth token cache: ${auth.tokenCacheFile}`)
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Linear OAuth token cache must be a regular file: ${auth.tokenCacheFile}`)
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error(`Linear OAuth token cache permissions must be 0600: ${auth.tokenCacheFile}`)
    }
    if (metadata.size > MAX_CACHE_BYTES) {
      throw new Error(`Linear OAuth token cache is unexpectedly large: ${auth.tokenCacheFile}`)
    }

    let cached: CachedOAuthToken | { version?: unknown }
    try {
      cached = JSON.parse(await readFile(auth.tokenCacheFile, "utf8")) as CachedOAuthToken
    } catch {
      throw new Error(`Linear OAuth token cache is invalid JSON: ${auth.tokenCacheFile}`)
    }
    if (cached.version === 1) return null
    if (
      cached.version !== 2 ||
      !("clientId" in cached) || typeof cached.clientId !== "string" ||
      !("tokenUrl" in cached) || typeof cached.tokenUrl !== "string" ||
      !("accessToken" in cached) ||
      typeof cached.accessToken !== "string" ||
      !("expiresAt" in cached) ||
      typeof cached.expiresAt !== "string" ||
      !("scopes" in cached) ||
      !Array.isArray(cached.scopes) ||
      !cached.scopes.every((scope) => typeof scope === "string")
    ) {
      throw new Error(`Linear OAuth token cache has an invalid schema: ${auth.tokenCacheFile}`)
    }
    if (cached.clientId !== auth.clientId || cached.tokenUrl !== auth.tokenUrl) return null

    const expiresAtMs = Date.parse(cached.expiresAt)
    if (!Number.isFinite(expiresAtMs)) {
      throw new Error(`Linear OAuth token cache has an invalid expiry: ${auth.tokenCacheFile}`)
    }
    return { accessToken: cached.accessToken, expiresAtMs, scopes: cached.scopes }
  }
}

const parseScopes = (scope: unknown): string[] => {
  if (Array.isArray(scope) && scope.every((item) => typeof item === "string")) return scope
  if (typeof scope !== "string") return []
  return scope.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
}

async function writeCachedToken(
  auth: Extract<LinearAuthConfig, { kind: "oauth-client-credentials" }>,
  token: ActiveOAuthToken
): Promise<void> {
  const cacheFile = auth.tokenCacheFile
  const parent = dirname(cacheFile)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const parentMetadata = await lstat(parent)
  if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory() || (parentMetadata.mode & 0o077) !== 0) {
    throw new Error(`Linear OAuth token cache directory permissions must be 0700: ${parent}`)
  }

  const temporaryFile = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporaryFile, "wx", 0o600)
    try {
      const cached: CachedOAuthToken = {
        version: 2,
        clientId: auth.clientId,
        tokenUrl: auth.tokenUrl,
        accessToken: token.accessToken,
        expiresAt: new Date(token.expiresAtMs).toISOString(),
        scopes: token.scopes
      }
      await handle.writeFile(`${JSON.stringify(cached)}\n`, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryFile, cacheFile)
  } catch (error) {
    await rm(temporaryFile, { force: true })
    throw error
  }
}

const isNodeError = (error: unknown, code: string): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === code
