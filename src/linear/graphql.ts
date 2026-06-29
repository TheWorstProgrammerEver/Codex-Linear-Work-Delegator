import type { Config } from "../env/types.js";

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
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
    });

    if (!response.ok) throw new Error(`Linear API HTTP ${response.status}: ${await response.text()}`);

    const payload = await response.json() as GraphQLResponse<T>;
    if (payload.errors?.length) throw new Error(formatGraphQLErrors(payload.errors));
    if (!payload.data) throw new Error("Linear API response did not include data");
    return payload.data;
  }
}

function formatGraphQLErrors(errors: GraphQLError[]): string {
  return `Linear API error: ${errors.map((error) => error.message).join("; ")}`;
}
