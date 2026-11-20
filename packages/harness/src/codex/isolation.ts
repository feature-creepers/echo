import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HarnessComputer, Scope, ToolServer } from '@repo/core'
import { asObject } from '../process/json.ts'
import { PROFILE, sandbox } from './sandbox/index.ts'

/**
 * What makes Codex an engine and nothing more (docs/SPEC.md, section 6.2).
 *
 * Codex has a switch for each thing it adds by itself: features are turned off by name, the user's tool
 * servers one by one, the instruction files of the working folder by giving them no room. A session without
 * access to the computer has no command line and a read-only sandbox; one with access has the command line, its
 * commands held by the system to what was granted, and each command or change it asks about is put to the core.
 */

/** The name the core's tool server has for Codex. */
export const TOOL_SERVER = 'core'

/** Features that act beyond the core's tools, or remember beyond the core's memory. A thread keeps its sub-agents. */
const FEATURES_OFF = ['apps', 'computer_use', 'browser_use', 'browser_use_external', 'in_app_browser', 'plugins', 'image_generation', 'multi_agent', 'memories']

/**
 * Settings given as `-c name=value`. Unlike a feature turned off by name, a setting Codex does not know is
 * ignored rather than refused, which suits the ones a version may not have.
 */
const SETTINGS_OFF = [
  // No room for AGENTS.md and the like, so none is read.
  'project_doc_max_bytes=0'
]

/** No command line of its own: the session acts through the core's tools only. */
const SHELL_OFF = 'features.shell_tool=false'

/**
 * How this computer's sandbox holds a session's commands: to the places granted, reading included (a permission
 * profile, which Seatbelt, bubblewrap and Windows' process isolation enforce), or only to the folders it may change
 * (Codex's older sandbox, where Windows has no process isolation).
 */
export type Holding = 'granted' | 'writes'

/**
 * Whether a session may have Codex's command line, which is how Codex reads and changes files. Where the sandbox
 * holds reading, whenever anything is granted. Where it holds only writing, a session with the command line could
 * read anything the person can, so it gets one only when they let the assistant read the whole computer.
 */
export function shellAllowed(scope: Scope | undefined, holding: Holding): boolean {
  if (scope === undefined) return false
  if (scope.computer !== 'off') return true
  return holding === 'granted' && scope.places.length > 0
}

/** How Codex's sessions work with files, as their instructions name it, for how its sandbox holds them here. */
export function codexComputer(holding: Holding): HarnessComputer {
  return {
    tools: 'shell and apply_patch',
    use: 'Look and run commands with your shell, and change files with apply_patch; a command that only reads runs at once, so prefer one when looking is all you need.',
    write: 'apply_patch',
    confines: holding === 'granted',
    needs: holding === 'granted' ? 'grant' : 'computer'
  }
}

/** What a profile holds commands to besides the scope: places of the person's programs, and of the adapter. */
interface Confinement {
  /** Places never reached besides the scope's: the adapter's own folder. */
  never: readonly string[]
  /** Folders programs write to on their own while a command runs: package caches, the temporary folder. */
  caches: readonly string[]
  /** What a command reads to run the person's programs: their search path's folders, their git settings. */
  programs: readonly string[]
}

/**
 * The permission profile a session's commands run under, from the scope. A command may read what the system's own
 * programs need, the person's programs and the places granted (the whole computer, when it may be read), change the
 * places that may be changed with the caches and the temporary folder, and never reach a place never reached; a
 * more precise entry wins over a broader one, and a refusal over anything else for the same place. Commands reach
 * the network: each is put to the core first, which holds it to the network policy as it does Claude Code's.
 */
export function permissionProfile(scope: Scope, confinement: Confinement): Record<string, unknown> {
  const filesystem: Record<string, 'read' | 'write' | 'deny'> = { ':minimal': 'read', ':tmpdir': 'write' }
  if (scope.computer !== 'off') filesystem[':root'] = scope.computer
  for (const program of confinement.programs) filesystem[program] = 'read'
  for (const cache of confinement.caches) filesystem[cache] = 'write'
  // Inside a place never reached, the folders that are reached all the same: the assistant's own, inside the app's data.
  if (scope.computer !== 'off') for (const place of scope.protected ?? []) for (const reopened of place.except ?? []) filesystem[reopened] = scope.computer
  for (const place of scope.places) filesystem[place.path] = place.write || scope.computer === 'write' ? 'write' : 'read'
  for (const place of scope.protected ?? []) if (place.path !== undefined) filesystem[place.path] = 'deny'
  for (const never of confinement.never) filesystem[never] = 'deny'
  return {
    ...sandbox.confined,
    default_permissions: PROFILE,
    permissions: { [PROFILE]: { filesystem, network: { enabled: true } } }
  }
}

/**
 * Whether the conversation Codex opened holds its commands as asked, from the sandbox it reports. Settings of the
 * person's own can put Codex back on its older sandbox, which ignores a profile; a session that asked for one and
 * reports no sandbox at all, without the whole computer to change, is not held, and must not run.
 */
export function heldAsAsked(reported: unknown, scope: Scope): boolean {
  const kind = asObject(reported)?.type
  if (kind === 'readOnly' || kind === 'workspaceWrite') return true
  return kind === 'dangerFullAccess' && scope.computer === 'write'
}

/**
 * The names of the tool servers in the user's own Codex settings. A session turns each of them off, so
 * that the only tools are the core's.
 */
export async function userToolServers(home: string): Promise<string[]> {
  const settings = await readFile(join(home, 'config.toml'), 'utf8').catch(() => '')
  const names = new Set<string>()
  for (const match of settings.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\]\s*$/gm)) {
    const name = match[1] ?? match[2] ?? match[3]
    if (name) names.add(name)
  }
  return [...names]
}

const settings = (values: string[]) => values.flatMap((value) => ['-c', value])

/**
 * Codex's own sub-agents, which a thread may hand parts of its work to (docs/SPEC.md, section 6.2). Each runs as a
 * conversation of its own on the same server, under the same sandbox and the same questions to the core.
 */
const AGENTS_FEATURE = 'multi_agent'

/**
 * The arguments of a live session: Codex as a server that takes requests on its standard input. A thread's keeps its
 * sub-agents; every other session has them turned off.
 */
export function appServerArguments(userServers: string[], shell = false, agents = false): string[] {
  return [
    'app-server',
    ...FEATURES_OFF.filter((feature) => !(agents && feature === AGENTS_FEATURE)).flatMap((feature) => ['--disable', feature]),
    ...settings(userServers.map((name) => `mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}.enabled=false`)),
    ...settings(shell ? SETTINGS_OFF : [SHELL_OFF, ...SETTINGS_OFF]),
    ...sandbox.server
  ]
}

/**
 * The folder a session with the command line works in: its project's, the assistant's own, or the first folder
 * granted. Without any, the temporary folder, which a profile lets commands use: never the adapter's own folder,
 * which holds nothing of the person's and which a profile refuses.
 */
export function workingFolder(scope: Scope, options: { folder: string; project?: string | undefined; profiled: boolean }): string {
  const granted = scope.places.find((place) => place.kind === 'folder')?.path
  return options.project ?? scope.home ?? granted ?? (options.profiled ? tmpdir() : options.folder)
}

/** How a conversation is opened on that server. */
export function threadSettings(options: {
  folder: string
  /** A project's folder, which the session works in when it has the command line. */
  project?: string | undefined
  model: string
  /** How hard the model reasons. Left out, the model's own default. */
  effort?: string | undefined
  instructions: string
  tools?: ToolServer | undefined
  /** What the session may reach, when it has the command line. Left out, it has none. */
  scope?: Scope | undefined
  /** How its commands are held, when it has the command line: to a profile of the scope, or by the older sandbox. */
  holding?: { kind: 'granted'; confinement: Confinement } | { kind: 'writes' } | undefined
}): Record<string, unknown> {
  const { scope, holding } = options
  const shell = scope !== undefined && holding !== undefined
  // With a profile, the sandbox is the profile's: naming one as well would put Codex back on its older sandbox.
  const profile = shell && holding.kind === 'granted' ? permissionProfile(scope, holding.confinement) : undefined
  // The older sandbox confines writing to the folders granted to change, unless the whole computer was given to change.
  const writable = (scope?.places ?? []).filter((place) => place.write && place.kind === 'folder').map((place) => place.path)
  const sandbox = !shell ? 'read-only' : profile ? undefined : scope.computer === 'write' ? 'danger-full-access' : 'workspace-write'
  const config = {
    ...profile,
    ...(options.tools
      ? {
          mcp_servers: {
            // A tool of the core may wait a long time for the user: an approval, an answer.
            [TOOL_SERVER]: { url: options.tools.url, http_headers: { Authorization: `Bearer ${options.tools.token}` }, tool_timeout_sec: 3600 }
          }
        }
      : {}),
    ...(sandbox === 'workspace-write' ? { sandbox_workspace_write: { writable_roots: writable, network_access: false } } : {}),
    ...(options.effort === undefined ? {} : { model_reasoning_effort: options.effort })
  }
  return {
    cwd: shell ? workingFolder(scope, { folder: options.folder, project: options.project, profiled: profile !== undefined }) : options.folder,
    model: options.model,
    // Ask before anything that is not plainly harmless. Each question is checked against what the person granted.
    approvalPolicy: 'untrusted',
    ...(sandbox === undefined ? {} : { sandbox }),
    // The conversation is ours to keep. Codex writes none of it to disk.
    ephemeral: true,
    developerInstructions: options.instructions,
    ...(Object.keys(config).length > 0 ? { config } : {})
  }
}

/**
 * The arguments of a single question. The instructions replace Codex's own system prompt; the user's
 * settings and rules are not read at all, so neither are their tool servers.
 */
export function execArguments(options: { model: string; effort?: string | undefined; instructions: string; answer: string }): string[] {
  return [
    'exec',
    ['-m', options.model],
    // A level Codex reads as a TOML string.
    options.effort === undefined ? [] : settings([`model_reasoning_effort="${options.effort}"`]),
    // A string in TOML. Forward slashes keep a Windows path free of escapes.
    settings([`model_instructions_file="${options.instructions.replace(/\\/g, '/')}"`, SHELL_OFF, ...SETTINGS_OFF]),
    '--ignore-user-config',
    '--ignore-rules',
    ['--sandbox', 'read-only'],
    '--ephemeral',
    '--skip-git-repo-check',
    ['--color', 'never'],
    // The answer alone is written to this file. Standard output also carries the CLI's own account of the run.
    ['-o', options.answer],
    // The question is read from standard input.
    '-'
  ].flat()
}
