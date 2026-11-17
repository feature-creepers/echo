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
