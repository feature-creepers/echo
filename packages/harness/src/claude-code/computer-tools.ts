import type { ComputerUse, Scope } from '@repo/core'
import { asWritten, kindAt } from '../computer/paths.ts'
import { reachOf } from '../computer/scope.ts'
import { asString, type JsonObject } from '../process/json.ts'
import { REPORTED_TOOLS } from '../tool-names.ts'

/** Claude Code's own tools for the computer, by what they do. */
const READING = ['Read', 'Glob', 'Grep']
const CHANGING = ['Write', 'Edit']
const RUNNING = ['Bash']

/** The tools a session is given for the scope it has: none, reading, or reading, changing and running commands. */
export function computerTools(scope: Scope | undefined): string[] {
  if (!scope) return []
  const { reads, writes } = reachOf(scope)
  return [...(reads ? READING : []), ...(writes ? [...CHANGING, ...RUNNING] : [])]
}

/** The name the core reports a use under, so the activity says what is going on. */
export const COMPUTER_TOOL_NAMES: Record<string, string> = {
  Read: REPORTED_TOOLS.read,
  Glob: REPORTED_TOOLS.search,
  Grep: REPORTED_TOOLS.search,
  Write: REPORTED_TOOLS.write,
  Edit: REPORTED_TOOLS.write,
  Bash: REPORTED_TOOLS.run
}

/** Where a glob pattern stops being a plain path: its folders up to the first one with a wildcard. */
function fixedPart(pattern: string): string {
  const parts = pattern.split(/[\\/]/)
  const at = parts.findIndex((part) => /[*?[\]{}]/.test(part))
  return (at < 0 ? parts.slice(0, -1) : parts.slice(0, at)).join('/') || '.'
}

/**
 * What a use of one of these tools does, and to what, from its input, its paths as written for the check to follow
 * them. A use that names no path works in the session's folder, as the tool does. Nothing for a tool that is not one of them.
 */
export async function useOf(tool: string, input: JsonObject, folder: string): Promise<ComputerUse | undefined> {
  const path = (value: unknown) => asWritten(asString(value) ?? '.', folder)
  switch (tool) {
    case 'Read':
      return { action: 'read', tool, paths: [path(input.file_path)] }
    case 'Glob': {
      const base = path(input.path)
      return { action: 'read', tool, paths: [...new Set([base, asWritten(fixedPart(asString(input.pattern) ?? ''), base)])] }
    }
    case 'Grep':
      return { action: 'read', tool, paths: [path(input.path)] }
    case 'Write': {
      const target = path(input.file_path)
      return { action: (await kindAt(target)) === undefined ? 'create' : 'change', tool, paths: [target] }
    }
    case 'Edit':
      return { action: 'change', tool, paths: [path(input.file_path)] }
    case 'Bash':
      return { action: 'run', tool, paths: [folder], command: asString(input.command) ?? '' }
    default:
      return undefined
  }
}
