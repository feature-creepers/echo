/**
 * What the assistant is doing, in a few words, from the tool it is using: shown in place of "Thinking" while
 * the user waits. A tool not named here is ordinary work; routing a turn is part of thinking.
 */
const DOING: Record<string, string | undefined> = {
  web_search: 'Searching the web',
  web_read: 'Reading a page',
  ui_render: 'Preparing the view',
  answer_write: 'Writing it up',
  file_write: 'Writing a document',
  file_read: 'Reading a document',
  memory_search: 'Remembering',
  memory_remember: 'Taking note',
  memory_forget: 'Forgetting',
  library_search: 'Looking in the library',
  library_show: 'Looking in the library',
  library_save: 'Saving it',
  library_update: 'Updating a widget',
  computer_read: 'Reading a file',
  computer_search: 'Searching files',
  computer_write: 'Changing a file',
  computer_run: 'Running a command',
  computer_grant: 'Asking for a folder',
  browser_open: 'Opening a page',
  browser_read: 'Reading the page',
  browser_snapshot: 'Looking at the page',
  browser_screenshot: 'Looking at the page',
  browser_scroll: 'Scrolling the page',
  browser_back: 'Going back',
  browser_tabs: 'Looking at the tabs',
  browser_wait: 'Waiting for the page',
  browser_click: 'Clicking',
  browser_type: 'Typing',
  browser_select: 'Choosing',
  browser_press: 'Pressing a key',
  browser_upload: 'Giving the page a file',
  clipboard_read: 'Reading the clipboard',
  clipboard_write: 'Copying to the clipboard',
  desktop_windows: 'Looking at your windows',
  desktop_look: 'Reading a window',
  desktop_screenshot: 'Looking at a window',
  desktop_focus: 'Bringing a window forward',
  desktop_scroll: 'Scrolling a window',
  desktop_click: 'Clicking',
  desktop_type: 'Typing',
  desktop_press: 'Pressing a key',
  thread_open: undefined,
  thread_send: undefined,
  thread_focus: undefined,
  ui_clear: undefined,
  media_control: undefined
}

/** The words for a tool at work, or nothing when "Thinking" says it already. */
export function doing(tool: string | undefined): string | undefined {
  if (tool === undefined) return undefined
  return Object.hasOwn(DOING, tool) ? DOING[tool] : 'Working'
}
