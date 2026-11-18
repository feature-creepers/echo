import type { ToolServer } from '@repo/core'
import { COMPUTER_TOOL_NAMES } from './computer-tools.ts'

/**
 * What makes Claude Code an engine and nothing more (docs/SPEC.md, section 6.2).
 *
 * Left to itself the CLI adds its own system prompt, tools, slash commands and skills, the user's settings
 * and tool servers, the instruction files of the folder it runs in, and a memory it keeps for that folder.
 * Each is switched off here. `--bare` would do it in one flag, but it refuses a subscription sign-in, which
 * is how most users are signed in.
 *
 * Checked against version 2.1.322, with a subscription: an instruction planted in `CLAUDE.md`,
 * `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/` or `AGENTS.md`, in the working folder or above
 * it, is not followed. The same instruction planted in the folder's auto-memory IS followed with the flags
 * alone, which is why the memory is switched off twice below, by a setting and by a variable.
 *
 * What the CLI still adds and gives no switch for: one sentence before the instructions saying it is a
 * Claude agent, a description of the machine after them (working folder, system, model, date), and the
 * address of the signed-in account in front of the first message.
 */

/** The name the core's tool server has for the CLI. It shows in the names the CLI gives the tools: `mcp__core__ui_render`. */
export const TOOL_SERVER = 'core'

const TOOL_PREFIX = `mcp__${TOOL_SERVER}__`

/** The CLI's own tools a session may be given: searching the web and reading a page. Nothing else of its own. */
export const WEB_TOOLS: Record<string, string> = { WebSearch: 'web_search', WebFetch: 'web_read' }

/** A tool's name as the core serves it, given the name the CLI uses. Nothing when the tool is not one of the core's. */
export function coreToolName(name: unknown): string | undefined {
  return typeof name === 'string' && name.startsWith(TOOL_PREFIX) && name.length > TOOL_PREFIX.length ? name.slice(TOOL_PREFIX.length) : undefined
}

/**
 * A tool's name as the core reports it: its own name for the core's tools, `web_search` or `web_read` for the
 * CLI's web tools, and `computer_read`, `computer_write` and the like for its tools on the computer, when given.
 */
export function reportedToolName(name: unknown, web: boolean, computer: readonly string[] = []): string | undefined {
  if (web && typeof name === 'string' && Object.hasOwn(WEB_TOOLS, name)) return WEB_TOOLS[name]
  if (typeof name === 'string' && computer.includes(name)) return COMPUTER_TOOL_NAMES[name]
  return coreToolName(name)
}

/** Settings handed to the CLI as a file. The user's own settings files are not read at all. */
export const ISOLATION_SETTINGS = { autoMemoryEnabled: false }

/**
 * The settings of a session given tools on the computer. Left to itself the CLI lets a read in its working
 * folders, or a command it judges harmless, run without asking. Asking for every use of each tool sends all of
 * them to the session's permission prompt, so the core checks each one against what the person granted.
 *
 * `confined`, the sandbox's settings where the system holds commands too (`confinement.ts`), is given when the
 * session runs commands.
 */
export function sessionSettings(computer: readonly string[], confined?: Record<string, unknown>): Record<string, unknown> {
  if (computer.length === 0) return ISOLATION_SETTINGS
  const permissions = { ...(confined?.permissions as Record<string, unknown> | undefined), ask: [...computer] }
  return { ...ISOLATION_SETTINGS, ...(confined ?? {}), permissions }
}

/** Variables that switch off what no flag does. */
export const ISOLATION_VARIABLES = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }

export interface IsolationFiles {
  /** The system prompt, whole. */
  instructions: string
  /** `ISOLATION_SETTINGS`, as JSON. */
  settings: string
  /** The tool server's address, as `toolServerConfig` writes it. Left out, the session has no tool. */
  tools?: string | undefined
  /** Whether the CLI's own web tools are kept. */
  web?: boolean
  /** The CLI's own tools for the computer the session is given, and the folders it may work in besides its own. */
  computer?: { tools: readonly string[]; folders: readonly string[] } | undefined
}

/** The arguments every call shares, live session or single question. Left out, the effort is the CLI's own choice. */
export function isolationArguments(model: string, files: IsolationFiles, effort?: string): string[] {
  return [
    ['--model', model],
    effort === undefined ? [] : ['--effort', effort],
    // Replaces the CLI's own system prompt instead of adding to it.
    ['--system-prompt-file', files.instructions],
    // None of its own tools but those given: the web, and the computer within what the person granted. No sub-agent.
    ['--tools', [...(files.web ? Object.keys(WEB_TOOLS) : []), ...(files.computer?.tools ?? [])].join(',')],
    (files.computer?.folders ?? []).flatMap((folder) => ['--add-dir', folder]),
    // Neither the user's settings nor the folder's, and with them no CLAUDE.md, no hook, no plugin.
    ['--setting-sources', ''],
    ['--settings', files.settings],
    // Only the tool server named here, never the user's own.
    '--strict-mcp-config',
    files.tools === undefined ? [] : ['--mcp-config', files.tools],
    '--disable-slash-commands',
    // The conversation is ours to keep. The CLI writes none of it to disk.
    '--no-session-persistence'
  ].flat()
}

/** The file that tells the CLI where the core's tool server is and what to present to it. */
export function toolServerConfig(tools: ToolServer): string {
  return JSON.stringify({ mcpServers: { [TOOL_SERVER]: { type: 'http', url: tools.url, headers: { Authorization: `Bearer ${tools.token}` } } } })
}

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/**
 * What a session has that it should not, read from the CLI's own account of how it started.
 *
 * A new version of the CLI may rename a flag or add a feature of its own. This says so the day it happens,
 * instead of an assistant that quietly knows more, or can do more, than the core gave it.
 */
export function isolationLeaks(init: Record<string, unknown>, web = false, computer: readonly string[] = []): string[] {
  const leaks: string[] = []
  const tools = names(init.tools).filter((tool) => reportedToolName(tool, web, computer) === undefined)
  if (tools.length > 0) leaks.push(`its own tools (${tools.join(', ')})`)
  const servers = Array.isArray(init.mcp_servers) ? init.mcp_servers.map((server: { name?: unknown }) => String(server?.name)) : []
  const others = servers.filter((server) => server !== TOOL_SERVER)
  if (others.length > 0) leaks.push(`other tool servers (${others.join(', ')})`)
  if (names(init.slash_commands).length > 0) leaks.push('slash commands')
  if (names(init.skills).length > 0) leaks.push('skills')
  const memory = init.memory_paths
  if (typeof memory === 'object' && memory !== null && Object.keys(memory).length > 0) leaks.push('its own memory')
  return leaks
}
