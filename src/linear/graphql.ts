import type { Config } from "../env/types.js"
import { LinearAuthorization, type LinearAuthorizationProvider } from "./auth.js"

interface GraphQLError {
  message: string
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLError[]
}

export class LinearGraphQLClient {
  constructor(
    private readonly config: Config,
    private readonly authorization: LinearAuthorizationProvider = new LinearAuthorization(config),
    private readonly requestFetch: typeof fetch = fetch
  ) {}

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let response = await this.send(query, variables)
    if (response.status === 401 && this.authorization.supportsRefresh) {
      await this.authorization.invalidate()
      response = await this.send(query, variables)
    }

    if (!response.ok) {
      const body = response.status === 401 ? "" : await response.text()
      throw new Error(formatHttpError(response.status, body))
    }

    const payload = await response.json() as GraphQLResponse<T>
    if (payload.errors?.length) throw new Error(formatGraphQLErrors(payload.errors))
    if (!payload.data) throw new Error("Linear API response did not include data")
    return payload.data
  }

  private async send(query: string, variables: Record<string, unknown>): Promise<Response> {
    return this.requestFetch(this.config.linearApiUrl, {
      method: "POST",
      headers: {
        "Authorization": await this.authorization.getAuthorizationHeader(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    })
  }
}

const formatGraphQLErrors = (errors: GraphQLError[]): string =>
  `Linear API error: ${errors.map((error) => error.message).join("; ")}`

const formatHttpError = (status: number, body: string): string => {
  const suffix = body ? `: ${body}` : ""
  const message = `Linear API HTTP ${status}${suffix}`
  if (!body.toLowerCase().includes("query complexity")) return message

  return `${message}
Linear rejected the GraphQL query for complexity. Review polling should use server-side team/status/reviewer-label filters; if this still happens, lower CODEX_LINEAR_FETCH_LIMIT temporarily and report the rejected query path.`
}
