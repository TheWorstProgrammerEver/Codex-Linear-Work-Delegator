import type { Config } from "../env/types.js"

interface GraphQLError {
  message: string
}

interface GraphQLResponse<T> {
  data?: T
  errors?: GraphQLError[]
}

export class LinearGraphQLClient {
  constructor(private readonly config: Config) {}

  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.config.linearApiUrl, {
      method: "POST",
      headers: {
        "Authorization": this.config.linearApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(formatHttpError(response.status, body))
    }

    const payload = await response.json() as GraphQLResponse<T>
    if (payload.errors?.length) throw new Error(formatGraphQLErrors(payload.errors))
    if (!payload.data) throw new Error("Linear API response did not include data")
    return payload.data
  }
}

const formatGraphQLErrors = (errors: GraphQLError[]): string =>
  `Linear API error: ${errors.map((error) => error.message).join("; ")}`

const formatHttpError = (status: number, body: string): string => {
  const message = `Linear API HTTP ${status}: ${body}`
  if (!body.toLowerCase().includes("query complexity")) return message

  return `${message}
Linear rejected the GraphQL query for complexity. Review polling should use server-side team/status/reviewer-label filters; if this still happens, lower CODEX_LINEAR_FETCH_LIMIT temporarily and report the rejected query path.`
}
