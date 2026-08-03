import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { LinearAuthorization } from "../dist/linear/auth.js"
import { LinearGraphQLClient } from "../dist/linear/graphql.js"

test("OAuth client credentials are minted once and reused from a protected persistent cache", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-oauth-"))
  const config = oauthConfig(join(root, "token.json"))
  const requests = []
  const tokenFetch = async (url, options) => {
    requests.push({ url, options })
    return Response.json({
      access_token: "test-access-token",
      token_type: "Bearer",
      expires_in: 2_592_000,
      scope: "read write"
    })
  }

  try {
    const first = new LinearAuthorization(config, { fetch: tokenFetch, now: () => 1_900_000_000_000 })
    assert.equal(await first.getAuthorizationHeader(), "Bearer test-access-token")
    assert.equal(await first.getMcpBearerToken(), "test-access-token")
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "https://linear.example/oauth/token")
    assert.equal(requests[0].options.method, "POST")
    assert.match(requests[0].options.headers.Authorization, /^Basic /)
    assert.equal(requests[0].options.headers["Content-Type"], "application/x-www-form-urlencoded")
    assert.equal(requests[0].options.body.toString(), "grant_type=client_credentials&scope=read%2Cwrite")
    assert.equal(statSync(config.linearAuth.tokenCacheFile).mode & 0o777, 0o600)

    const second = new LinearAuthorization(config, {
      fetch: async () => { throw new Error("persistent cache should prevent a second mint") },
      now: () => 1_900_000_001_000
    })
    assert.equal(await second.getAuthorizationHeader(), "Bearer test-access-token")

    const otherConfig = {
      linearAuth: { ...config.linearAuth, clientId: "other-agent-client-id" }
    }
    const otherAgent = new LinearAuthorization(otherConfig, {
      fetch: async () => Response.json({
        access_token: "other-agent-token",
        token_type: "Bearer",
        expires_in: 2_592_000,
        scope: "read write"
      }),
      now: () => 1_900_000_002_000
    })
    assert.equal(await otherAgent.getAuthorizationHeader(), "Bearer other-agent-token")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("OAuth token failures are bounded and do not echo response secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-oauth-failure-"))
  const config = oauthConfig(join(root, "token.json"))
  const leaked = "must-not-appear-in-errors"
  const authorization = new LinearAuthorization(config, {
    fetch: async () => new Response(JSON.stringify({ error_description: leaked }), { status: 400 })
  })

  try {
    await assert.rejects(
      () => authorization.getAuthorizationHeader(),
      (error) => {
        assert.match(error.message, /HTTP 400/)
        assert.doesNotMatch(error.message, new RegExp(leaked))
        assert.doesNotMatch(error.message, /test-client-secret/)
        return true
      }
    )
    assert.equal(existsSync(config.linearAuth.tokenCacheFile), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("OAuth cache with broad permissions fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-linear-oauth-mode-"))
  const config = oauthConfig(join(root, "token.json"))
  const authorization = new LinearAuthorization(config, {
    fetch: async () => Response.json({
      access_token: "test-access-token",
      token_type: "Bearer",
      expires_in: 2_592_000,
      scope: "read write"
    })
  })

  try {
    await authorization.getAuthorizationHeader()
    chmodSync(config.linearAuth.tokenCacheFile, 0o644)
    const nextProcess = new LinearAuthorization(config, {
      fetch: async () => { throw new Error("must not mint past an unsafe cache") }
    })
    await assert.rejects(() => nextProcess.getAuthorizationHeader(), /permissions must be 0600/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("GraphQL retries one OAuth 401 after invalidating the cached token", async () => {
  const headers = ["Bearer stale", "Bearer fresh"]
  let invalidations = 0
  let fetchCalls = 0
  const authorization = {
    supportsRefresh: true,
    getAuthorizationHeader: async () => headers.shift(),
    getMcpBearerToken: async () => undefined,
    invalidate: async () => { invalidations += 1 }
  }
  const graphFetch = async (_url, options) => {
    fetchCalls += 1
    if (fetchCalls === 1) {
      assert.equal(options.headers.Authorization, "Bearer stale")
      return new Response("expired-token-body", { status: 401 })
    }
    assert.equal(options.headers.Authorization, "Bearer fresh")
    return Response.json({ data: { viewer: { id: "app-user" } } })
  }
  const client = new LinearGraphQLClient(
    { ...oauthConfig("/unused/token.json"), linearApiUrl: "https://linear.example/graphql" },
    authorization,
    graphFetch
  )

  assert.deepEqual(await client.request("query { viewer { id } }", {}), { viewer: { id: "app-user" } })
  assert.equal(invalidations, 1)
  assert.equal(fetchCalls, 2)
})

test("GraphQL does not retry API-key 401 responses or echo their body", async () => {
  let fetchCalls = 0
  const authorization = {
    supportsRefresh: false,
    getAuthorizationHeader: async () => "api-key",
    getMcpBearerToken: async () => undefined,
    invalidate: async () => { throw new Error("must not invalidate API keys") }
  }
  const client = new LinearGraphQLClient(
    { linearAuth: { kind: "api-key", apiKey: "api-key" }, linearApiUrl: "https://linear.example/graphql" },
    authorization,
    async () => {
      fetchCalls += 1
      return new Response("sensitive-upstream-body", { status: 401 })
    }
  )

  await assert.rejects(
    () => client.request("query { viewer { id } }", {}),
    (error) => {
      assert.equal(error.message, "Linear API HTTP 401")
      assert.doesNotMatch(error.message, /sensitive-upstream-body/)
      return true
    }
  )
  assert.equal(fetchCalls, 1)
})

const oauthConfig = (tokenCacheFile) => ({
  linearAuth: {
    kind: "oauth-client-credentials",
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    tokenUrl: "https://linear.example/oauth/token",
    scopes: ["read", "write"],
    tokenCacheFile
  }
})
