import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolServer } from '@repo/core'
import { SANDBOX_SETTINGS } from './sandbox/index.ts'

/**
 * What makes Codex an engine and nothing more (docs/SPEC.md, section 6.2).
 *
 * Codex has a switch for each thing it adds by itself: features are turned off by name, the user's tool
 * servers one by one, the instruction files of the working folder by giving them no room. Its sandbox is
 * read-only, and every request to run a command or change a file is declined by the session.
 */

/** The name the core's tool server has for Codex. */
export const TOOL_SERVER = 'core'

/** Features that act beyond the core's tools, or remember beyond the core's memory. */
export const FEATURES_OFF = [
  'apps',
  'computer_use',
  'browser_use',
  'browser_use_external',
  'in_app_browser',
  'plugins',
  'image_generation',
  'multi_agent',
  'memories'
]

/**
 * Settings given as `-c name=value`. Unlike a feature turned off by name, a setting Codex does not know is
 * ignored rather than refused, which suits the ones a version may not have.
 */
const SETTINGS_OFF = [
  // No command line of its own: the session acts through the core's tools only.
  'features.shell_tool=false',
  // No room for AGENTS.md and the like, so none is read.
  'project_doc_max_bytes=0'
]

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

/** The arguments of a live session: Codex as a server that takes requests on its standard input. */
export function appServerArguments(userServers: string[]): string[] {
  return [
    'app-server',
    ...FEATURES_OFF.flatMap((feature) => ['--disable', feature]),
    ...settings(userServers.map((name) => `mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}.enabled=false`)),
    ...settings(SETTINGS_OFF),
    ...SANDBOX_SETTINGS
  ]
}

/** How a conversation is opened on that server. */
export function threadSettings(options: { folder: string; model: string; instructions: string; tools?: ToolServer | undefined }): Record<string, unknown> {
  return {
    cwd: options.folder,
    model: options.model,
    // Ask before anything that is not plainly harmless, and write nothing: the session then declines what is asked.
    approvalPolicy: 'untrusted',
    sandbox: 'read-only',
    // The conversation is ours to keep. Codex writes none of it to disk.
    ephemeral: true,
    developerInstructions: options.instructions,
    ...(options.tools
      ? {
          config: {
            mcp_servers: {
              // A tool of the core may wait a long time for the user: an approval, an answer.
              [TOOL_SERVER]: { url: options.tools.url, http_headers: { Authorization: `Bearer ${options.tools.token}` }, tool_timeout_sec: 3600 }
            }
          }
        }
      : {})
  }
}

/**
 * The arguments of a single question. The instructions replace Codex's own system prompt; the user's
 * settings and rules are not read at all, so neither are their tool servers.
 */
export function execArguments(options: { model: string; instructions: string; answer: string }): string[] {
  return [
    'exec',
    ['-m', options.model],
    // A string in TOML. Forward slashes keep a Windows path free of escapes.
    settings([`model_instructions_file="${options.instructions.replace(/\\/g, '/')}"`, ...SETTINGS_OFF]),
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
