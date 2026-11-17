import type { ToolDefinition, ToolHost, ToolResult } from '../ports/tools.ts'

/** A tool the core serves: what a model sees of it, and what it does. */
export interface Tool {
  definition: ToolDefinition
  /** Run it. A refusal is a result with `ok: false` whose text says why, so the model can correct itself. */
  run(input: unknown): ToolResult | Promise<ToolResult>
}

/** The right to call some tools, held by one session through its token. */
export interface Grant {
  token: string
  /** End the right: the token is no longer anyone's. */
  revoke(): void
}

export interface Tools {
  /** What a tool server calls. */
  host: ToolHost
  /** Give a session the right to call these tools, under a token only it holds. */
  grant(tools: readonly Tool[]): Grant
}

/**
 * The tools of the core, as sessions reach them. Each session gets a token of its own when it opens, which
 * says what it may call; the tool server passes every call here with the token it came with.
 */
export function createTools(newToken: () => string): Tools {
  const grants = new Map<string, readonly Tool[]>()
  return {
    host: {
      list: (token) => grants.get(token)?.map((tool) => tool.definition),
      async call(token, name, input) {
        const tool = grants.get(token)?.find((candidate) => candidate.definition.name === name)
        if (!tool) return { ok: false, text: `There is no tool named "${name}".` }
        try {
          return await tool.run(input)
        } catch (error) {
          return { ok: false, text: `The tool failed: ${error instanceof Error ? error.message : String(error)}` }
        }
      }
    },
    grant(tools) {
      const token = newToken()
      grants.set(token, tools)
      return { token, revoke: () => void grants.delete(token) }
    }
  }
}
