import type { AccessUse, Step } from '@repo/protocol'
import type { Relative } from '../changes/diff-view.tsx'

/** What each tool did, in a few words, for the list of calls. */
const TOOL_TITLES: Record<string, string> = {
  web_search: 'Searched the web',
  web_read: 'Read a page',
  ui_render: 'Showed a view',
  ui_clear: 'Cleared the screen',
  media_control: 'Controlled the player',
  answer_write: 'Wrote the full answer',
  thread_open: 'Opened this thread',
  thread_send: 'Passed it to this thread',
  thread_focus: 'Brought a topic back',
  file_write: 'Wrote a document',
  file_read: 'Read a document',
  memory_search: 'Searched the memory',
  memory_remember: 'Remembered',
  memory_forget: 'Forgot',
  library_search: 'Searched the library',
  library_show: 'Showed a saved widget',
  library_save: 'Saved a widget',
  library_update: 'Changed a saved widget',
  library_delete: 'Deleted a saved widget',
  computer_read: 'Read a file',
  computer_search: 'Searched files',
  computer_write: 'Changed a file',
  computer_run: 'Ran a command',
  computer_grant: 'Asked for a folder',
  browser_open: 'Opened a page',
  browser_read: 'Read the page',
  browser_snapshot: 'Looked at the page',
  browser_screenshot: 'Took a picture of the page',
  browser_scroll: 'Scrolled',
  browser_back: 'Went back',
  browser_tabs: 'Looked at the tabs',
  browser_wait: 'Waited',
  browser_click: 'Clicked',
  browser_type: 'Typed',
  browser_select: 'Chose',
  browser_press: 'Pressed a key',
  browser_upload: 'Gave the page a file',
  clipboard_read: 'Read the clipboard',
  clipboard_write: 'Copied to the clipboard',
  desktop_windows: 'Looked at the windows',
  desktop_look: 'Read a window',
  desktop_screenshot: 'Took a picture of a window',
  desktop_focus: 'Brought a window forward',
  desktop_scroll: 'Scrolled a window',
  desktop_click: 'Clicked',
  desktop_type: 'Typed',
  desktop_press: 'Pressed a key',
  copy_prepare: 'Prepared a copy of the project'
}

/** A path whole, when nothing says what it is relative to. */
const whole: Relative = (path) => path

const fieldsOf = (step: Step): Record<string, unknown> | undefined =>
  typeof step.input === 'object' && step.input !== null && !Array.isArray(step.input) ? (step.input as Record<string, unknown>) : undefined
const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const firstLine = (value: string) => value.split('\n')[0]?.trim() ?? value

/** The files a change of files names: one for Claude Code's Write and Edit, a list for Codex's changes. */
function filesOf(step: Step): string[] {
  const fields = fieldsOf(step)
  const one = text(fields?.file_path)
  if (one) return [one]
  return Array.isArray(fields?.paths) ? fields.paths.filter((path): path is string => typeof path === 'string') : []
}

/** What a call did, in a few words: "Read a file", "Created a file", "Changed 3 files". */
export function stepTitle(step: Step, use?: AccessUse): string {
  if (step.tool === 'computer_write') {
    const files = use?.changes?.length ?? filesOf(step).length
    const action = use?.action ?? (text(fieldsOf(step)?.old_string) !== undefined ? 'change' : undefined)
    if (files > 1) return `Changed ${files} files`
    return action === 'create' ? 'Created a file' : action === 'delete' ? 'Deleted a file' : 'Changed a file'
  }
  return TOOL_TITLES[step.tool] ?? step.tool
}

/** The command a call ran, whole, when it ran one. */
export function commandOf(step: Step): string | undefined {
  return step.tool === 'computer_run' ? text(fieldsOf(step)?.command) : undefined
}

/** The words a page's action gave back, between quotes: the button clicked, the option chosen. */
const quotedIn = (output: string | undefined) => output?.match(/“([^”]+)”/)?.[1]

/** The one line that says what a call was about: the file, the command, the query, the address, the view's title. */
export function stepSummary(step: Step, relative: Relative = whole): string | undefined {
  const fields = fieldsOf(step)
  switch (step.tool) {
    case 'computer_read': {
      const file = text(fields?.file_path)
      return file && relative(file)
    }
    case 'computer_search': {
      const pattern = text(fields?.pattern)
      const path = text(fields?.path)
      // A search of the folder the work is in names no folder: it is where everything else is named from.
      const where = path && relative(path)
      return pattern && where && where !== '.' ? `${pattern} in ${where}` : pattern
    }
    case 'computer_write': {
      const [first, ...rest] = filesOf(step)
      if (!first) return undefined
      return rest.length > 0 ? `${relative(first)} and ${rest.length} more` : relative(first)
    }
    case 'computer_run': {
      const command = commandOf(step)
      return command && firstLine(command)
    }
    case 'computer_grant':
      return text(fields?.path)
    case 'thread_send':
    case 'thread_focus':
      // A thread is named by its identifier, which says nothing to the person: what was passed on, when written, does.
      return text(fields?.request)
    case 'desktop_click': {
      const quoted = quotedIn(step.output)
      return quoted ? `“${quoted}”` : undefined
    }
    case 'browser_click':
    case 'browser_select': {
      const quoted = quotedIn(step.output)
      if (quoted) return `“${quoted}”`
      return Array.isArray(fields?.values) ? fields.values.filter((value) => typeof value === 'string').join(', ') : undefined
    }
    case 'desktop_type':
    case 'browser_type': {
      const typed = text(fields?.text)
      return typed && `“${typed}”${fields?.submit === true ? ', then Enter' : ''}`
    }
    case 'browser_press':
    case 'desktop_press':
      return text(fields?.key)
    case 'desktop_scroll':
    case 'browser_scroll':
      return text(fields?.direction)
    case 'browser_wait':
      return text(fields?.text) ?? (typeof fields?.seconds === 'number' ? `${fields.seconds} s` : undefined)
    case 'browser_upload':
      return Array.isArray(fields?.paths)
        ? fields.paths
            .filter((path): path is string => typeof path === 'string')
            .map(relative)
            .join(', ')
        : undefined
    case 'desktop_windows':
    case 'desktop_look':
    case 'desktop_screenshot':
    case 'desktop_focus':
    case 'browser_read':
    case 'browser_snapshot':
    case 'browser_screenshot':
    case 'browser_back':
    case 'browser_tabs':
      return undefined
  }
  if (typeof step.input === 'string') return step.input
  if (!fields) return undefined
  for (const name of ['query', 'url', 'title', 'request', 'name']) {
    const value = text(fields[name])
    if (value) return value
  }
  return Object.values(fields)
    .map(text)
    .find((value) => value !== undefined)
}
