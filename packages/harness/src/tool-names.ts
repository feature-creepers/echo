/**
 * The names the CLIs' own tools are reported under, the same whichever harness runs them, so the activity reads
 * alike for both (docs/SPEC.md, section 6.2).
 */
export const REPORTED_TOOLS = {
  read: 'computer_read',
  search: 'computer_search',
  write: 'computer_write',
  run: 'computer_run',
  subagent: 'subagent',
  webSearch: 'web_search',
  webRead: 'web_read'
} as const
