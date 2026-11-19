/**
 * What every reader of an Office file gives a preview, whatever the format: a document as Markdown, a workbook as
 * tables, a presentation as the text of its slides, each with the pictures and charts it holds, and how much of each
 * is shown.
 */

import type { DocumentLook } from './document-look.ts'
import type { SheetLook } from './sheet-look.ts'

/** A chart as its file last drew it: its kind, as near as the Chart block draws, and the values it kept. */
export interface OfficeChart {
  title: string
  chart: 'line' | 'area' | 'bar'
  series: { name: string; points: { x: string; y: number }[] }[]
}

/**
 * A picture or a chart a file holds, where the file places it. A picture in a format the window cannot show (an
 * EMF, a TIFF) or a chart with no values kept is `unshown`, and says what it is.
 */
export type OfficeFigure = PictureFigure | ({ kind: 'chart' } & OfficeChart) | { kind: 'unshown'; alt: string; what: 'picture' | 'chart' }

/** A picture of a file, from its bytes, at the size the file gives it. */
export type PictureFigure = { kind: 'picture'; type: string; bytes: Uint8Array; alt: string; width?: number | undefined; height?: number | undefined }

/**
 * What a preview of an Office file shows. A document's Markdown names its figures as pictures whose address is
 * `figure:` and their place in `figures`; its look, when it could be read, is shown in its place.
 */
export type OfficePreview =
  | { kind: 'document'; markdown: string; figures: OfficeFigure[]; cut: boolean; look?: DocumentLook | undefined }
  | { kind: 'workbook'; sheets: { name: string; rows: string[][]; cut: boolean; figures: OfficeFigure[]; look?: SheetLook | undefined }[] }
  | { kind: 'presentation'; slides: { title: string; lines: string[]; figures: OfficeFigure[]; drawing?: PictureFigure }[]; cut: boolean }

/** What a file protected with a password says, whatever its format. */
export const PROTECTED = 'It is protected with a password, so its text cannot be read here.'

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
    .replace(/[\\`*_[\]<>|#~]/g, '\\$&')
    .replace(/^(\s*)(\d+)([.)]) /, '$1$2\\$3 ')
    .replace(/^(\s*)([-+]) /, '$1\\$2 ')
}

/** A document's table as a Markdown table: its first row the head, every row as wide as the widest. Its cells are written by `cell`. */
export function markdownTable(table: string[][], cell: (text: string) => string = plain): string {
  const width = Math.max(...table.map((one) => one.length))
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, column) => cell(cells[column] ?? '').replace(/\n/g, ' ')).join(' | ')} |`
  const [head = [], ...body] = table
  return [line(head), `|${' --- |'.repeat(width)}`, ...body.map(line)].join('\n')
}

/** A list item's line of Markdown: a bullet or a number, and the item's depth. */
const LIST_ITEM = /^\s*(-|\d+\.) /

/** A document's blocks as Markdown: a paragraph apart from the next, the items of a list one under the other, as one list. */
export function joinBlocks(blocks: readonly string[]): string {
  return blocks.reduce((joined, block, index) => {
    if (index === 0) return block
    const together = LIST_ITEM.test(block) && LIST_ITEM.test(blocks[index - 1] ?? '')
    return `${joined}${together ? '\n' : '\n\n'}${block}`
  }, '')
}

/** How a span of a paragraph's text is set: strong, slanted, struck, or a link and where it leads. */
export interface Format {
  bold?: boolean | undefined
  italic?: boolean | undefined
  struck?: boolean | undefined
  link?: string | undefined
}

/** A piece of a paragraph: text and how it is set, or a figure where the paragraph holds it. */
export type InlinePart = ({ text: string } & Format) | { figure: number; alt: string }

/** A paragraph's text alone, without its figures or its format. */
export const partsText = (parts: readonly InlinePart[]): string => parts.map((part) => ('text' in part ? part.text : '')).join('')

/** A figure as Markdown names it. */
export const figureMark = (figure: number, alt: string): string => `![${plain(alt.replace(/\s+/g, ' ').trim())}](figure:${figure})`

const sameFormat = (one: Format, other: Format) =>
  Boolean(one.bold) === Boolean(other.bold) &&
  Boolean(one.italic) === Boolean(other.italic) &&
  Boolean(one.struck) === Boolean(other.struck) &&
  one.link === other.link

/** A letter or a digit: next to one, emphasis is written with stars, which Markdown reads inside a word. */
const WORDLY = /[\p{L}\p{N}]/u

/** An address as a Markdown link holds it, with nothing that would end it early. */
const linkAddress = (address: string) =>
  address.replace(/[\s()]/g, (character) => (character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character))) || '#'

/**
 * A paragraph's parts as Markdown, a line for each of its line breaks: its text escaped, each span set as its format
 * says (`**strong**`, `_slanted_`, `~~struck~~`, `[a link](address)`, with the space around a span left outside its
 * marks), and its figures where they are.
 */
export function inlineLines(parts: readonly InlinePart[]): string[] {
  const lines: InlinePart[][] = [[]]
  for (const part of parts) {
    if (!('text' in part)) {
      lines.at(-1)?.push(part)
      continue
    }
    part.text.split('\n').forEach((piece, index) => {
      if (index > 0) lines.push([])
      if (piece === '') return
      const line = lines.at(-1)
      const last = line?.at(-1)
      if (last && 'text' in last && sameFormat(last, part)) last.text += piece
      else line?.push({ ...part, text: piece })
    })
  }
  // A break at a paragraph's start or end makes no line of its own.
  while (lines.length > 1 && lines[0]?.length === 0) lines.shift()
  while (lines.length > 1 && lines.at(-1)?.length === 0) lines.pop()
  return lines.map((line) => {
    let written = ''
    line.forEach((part, index) => {
      if (!('text' in part)) {
        written += figureMark(part.figure, part.alt)
        return
      }
      const set = part.bold || part.italic || part.struck || part.link !== undefined
      const [, before = '', core = '', after = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(part.text) ?? []
      if (!set || core === '') {
        written += plain(part.text)
        return
      }
      const next = line[index + 1]
      const following = next && 'text' in next ? next.text : ''
      const inWord = (before === '' && WORDLY.test(written.at(-1) ?? '')) || (after === '' && WORDLY.test(following[0] ?? ''))
      let marked = plain(core)
      if (part.italic) marked = inWord ? `*${marked}*` : `_${marked}_`
      if (part.bold) marked = `**${marked}**`
      if (part.struck) marked = `~~${marked}~~`
      if (part.link !== undefined) {
        // An exclamation mark just before a link would make it a picture.
        if (before === '' && written.endsWith('!')) written = `${written.slice(0, -1)}\\!`
        marked = `[${marked}](${linkAddress(part.link)})`
      }
      written += before + marked + after
    })
    return written.trim()
  })
}
