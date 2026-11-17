/**
 * What the core serves to harness sessions as tools, and what a tool server needs from the core to serve them.
 *
 * Reply text is speech; tool calls are the screen and every action. A tool server (MCP, in `@repo/tools`)
 * carries calls to a `ToolHost`. It knows nothing about what the tools do.
 */

/** A tool as a model sees it. */
export interface ToolDefinition {
  /** Unique among the tools of a session: `ui.render`, `memory.search`. */
  name: string
  /** What it does and when to use it, written for a model. */
  description: string
  /** The input it takes, as a JSON Schema object. */
  inputSchema: Record<string, unknown>
}

/** What a model reads back after a call. */
export interface ToolResult {
  /** False when the call was refused or failed. The text then says why, so the model can correct itself. */
  ok: boolean
  text: string
}

export interface ToolHost {
  /** The tools the session holding this token may call. Nothing when the token is not a session's. */
  list(token: string): ToolDefinition[] | undefined
  /** Run a tool for the session holding this token. Never rejects: a failure is a result with `ok: false`. */
  call(token: string, name: string, input: unknown): Promise<ToolResult>
}
