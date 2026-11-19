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

/** The CLI's own tools a session may be given: searching the web and reading a page. */
export const WEB_TOOLS: Record<string, string> = { WebSearch: 'web_search', WebFetch: 'web_read' }

/**
 * The CLI's own to-do list, which a session working on a project keeps its plan in (docs/SPEC.md, section 7.11). It
 * acts on nothing: what it is given is read as the plan, not as a call. Nothing else of the CLI's own is given.
 */
export const PLAN_TOOL = 'TodoWrite'

/**
 * The CLI's own sub-agents, which a thread may hand parts of its work to (docs/SPEC.md, section 6.2). `--tools` names
 * the tool `Task`, and the model calls it `Agent`. A sub-agent works with the CLI's tools the session was given, held to
 * the same scope and approved the same way, and never with the core's: the voice, the screen and the person are its
 * thread's. Each of its calls is reported, so the person sees what it did.
 */
export const AGENT_TOOL = 'Task'

/** The names the CLI gives the sub-agents' tool: in its account of how it started, and in the model's calls. */
const AGENT_TOOL_NAMES = new Set([AGENT_TOOL, 'Agent'])

/** The name a call of a sub-agent is reported under. */
export const REPORTED_AGENT_TOOL = 'subagent'

/** What a session was given of the CLI's own: the web, its tools on the computer, its to-do list and its sub-agents. */
export interface Given {
  web?: boolean | undefined
  computer?: readonly string[] | undefined
  plan?: boolean | undefined
  agents?: boolean | undefined
}

/** A tool's name as the core serves it, given the name the CLI uses. Nothing when the tool is not one of the core's. */
export function coreToolName(name: unknown): string | undefined {
  return typeof name === 'string' && name.startsWith(TOOL_PREFIX) && name.length > TOOL_PREFIX.length ? name.slice(TOOL_PREFIX.length) : undefined
}

/**
 * A tool's name as the core reports it: its own name for the core's tools, `web_search` or `web_read` for the
 * CLI's web tools, `computer_read`, `computer_write` and the like for its tools on the computer, and `subagent` for
 * its sub-agents, when given.
 */
export function reportedToolName(name: unknown, given: Given = {}): string | undefined {
  if (typeof name !== 'string') return undefined
  if (given.web && Object.hasOwn(WEB_TOOLS, name)) return WEB_TOOLS[name]
  if (given.computer?.includes(name)) return COMPUTER_TOOL_NAMES[name]
  if (given.agents && AGENT_TOOL_NAMES.has(name)) return REPORTED_AGENT_TOOL
  return coreToolName(name)
}

/** Settings handed to the CLI as a file. The user's own settings files are not read at all. */
export const ISOLATION_SETTINGS = { autoMemoryEnabled: false }

/** The rule that names every tool of the core's tool server. */
const CORE_TOOLS_RULE = `mcp__${TOOL_SERVER}`

/**
 * The settings of a session given tools on the computer. Left to itself the CLI lets a read in its working
 * folders, or a command it judges harmless, run without asking. Asking for every use of each tool sends all of
 * them to the session's permission prompt, so the core checks each one against what the person granted.
 *
 * `confined`, the sandbox's settings where the system holds commands too (`confinement.ts`), is given when the
 * session runs commands. A session with sub-agents is asked about every call of the core's tools as well: the
 * question says when a sub-agent makes it, and the core's tools are refused to sub-agents.
 */
export function sessionSettings(computer: readonly string[], confined?: Record<string, unknown>, agents = false): Record<string, unknown> {
  const ask = [...computer, ...(agents ? [CORE_TOOLS_RULE] : [])]
  if (ask.length === 0) return ISOLATION_SETTINGS
  const permissions = { ...(confined?.permissions as Record<string, unknown> | undefined), ask }
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
  /** Whether the session keeps its plan in the CLI's own to-do list: a project's does. */
  plan?: boolean
  /** Whether the session may hand parts of its work to the CLI's own sub-agents: a thread's may. */
  agents?: boolean
}

/** The arguments every call shares, live session or single question. Left out, the effort is the CLI's own choice. */
export function isolationArguments(model: string, files: IsolationFiles, effort?: string): string[] {
  return [
    ['--model', model],
    effort === undefined ? [] : ['--effort', effort],
    // Replaces the CLI's own system prompt instead of adding to it.
    ['--system-prompt-file', files.instructions],
    // None of its own tools but those given: the web, the computer within what the person granted, for a project its
    // to-do list, and for a thread its sub-agents.
    [
      '--tools',
      [
        ...(files.web ? Object.keys(WEB_TOOLS) : []),
        ...(files.computer?.tools ?? []),
        ...(files.plan ? [PLAN_TOOL] : []),
        ...(files.agents ? [AGENT_TOOL] : [])
      ].join(',')
    ],
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
export function isolationLeaks(init: Record<string, unknown>, given: Given = {}): string[] {
  const leaks: string[] = []
  const tools = names(init.tools).filter((tool) => reportedToolName(tool, given) === undefined && !(given.plan && tool === PLAN_TOOL))
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
