/**
 * What every reader of an Office file gives a preview, whatever the format: a document as Markdown, a workbook as
 * tables, a presentation as the text of its slides, and how much of each is shown.
 */

/** What a preview of an Office file shows. */
export type OfficePreview =
  | { kind: 'document'; markdown: string; cut: boolean }
  | { kind: 'workbook'; sheets: { name: string; rows: string[][]; cut: boolean }[] }
  | { kind: 'presentation'; slides: { title: string; lines: string[] }[]; cut: boolean }

/** How much of a document is shown, in paragraphs and table rows. */
export const BLOCK_LIMIT = 5_000
/** How many rows and columns of a sheet are shown, and how many sheets. */
export const ROW_LIMIT = 500
export const COLUMN_LIMIT = 50
export const SHEET_LIMIT = 20
/** How many slides are shown. */
export const SLIDE_LIMIT = 300

/** Text written so Markdown shows it as it is: its marks escaped, a line not taken for a heading or a list. */
export function plain(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|#]/g, '\\$&')
    .replace(/^(\s*)(\d+)\. /, '$1$2\\. ')
    .replace(/^(\s*)([-+]) /, '$1\\$2 ')
}

/** A document's table as a Markdown table: its first row the head, every row as wide as the widest. */
export function markdownTable(table: string[][]): string {
  const width = Math.max(...table.map((one) => one.length))
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, column) => plain(cells[column] ?? '').replace(/\n/g, ' ')).join(' | ')} |`
  const [head = [], ...body] = table
  return [line(head), `|${' --- |'.repeat(width)}`, ...body.map(line)].join('\n')
}
