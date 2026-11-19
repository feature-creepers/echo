/**
 * A document as it looks (docs/SPEC.md, section 9.7), whatever format it comes from: its pages at their size and
 * margins, each with its header and footer, its paragraphs in their fonts, sizes, colours, alignment, indents and
 * spacing, its lists' numbers and bullets, its tables with their borders and shading, and its pictures and charts where
 * they are. Each format reads its own records into this (`word-look.ts` for Word 2007 and later), and
 * `document-view.tsx` shows it. Every length is in points.
 */

/** How a run of text is set. A colour is six hexadecimal digits after `#`, checked when it is read. */
export interface TextLook {
  font?: string | undefined
  size?: number | undefined
  color?: string | undefined
  bold?: boolean | undefined
  italic?: boolean | undefined
  underline?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy' | undefined
  struck?: boolean | undefined
  highlight?: string | undefined
  position?: 'super' | 'sub' | undefined
  caps?: 'all' | 'small' | undefined
  /** Space added between letters. */
  spacing?: number | undefined
}

/** A line around a paragraph, a table or a cell: its width, its kind and its colour. */
export interface BorderLook {
  width: number
  style: 'solid' | 'double' | 'dotted' | 'dashed'
  color: string
}

export type Sides<Value> = { top?: Value | undefined; right?: Value | undefined; bottom?: Value | undefined; left?: Value | undefined }

/** Where a paragraph's tab goes, and what fills the space before it. */
export interface TabStop {
  position: number
  align: 'left' | 'center' | 'right' | 'decimal'
  leader?: 'dot' | 'hyphen' | 'underscore' | undefined
}

/**
 * How a paragraph is laid out: its alignment, indents (the first line's as a change from the start's, negative for a
 * hanging one), the space before and after it, the height of its lines (a multiple of a single line, exactly a
 * height, or at least one), its shading, its borders and its tab stops.
 */
export interface ParagraphLook {
  align?: 'left' | 'center' | 'right' | 'justify' | undefined
  start?: number | undefined
  end?: number | undefined
  firstLine?: number | undefined
  before?: number | undefined
  after?: number | undefined
  line?: { rule: 'multiple' | 'exact' | 'least'; value: number } | undefined
  shading?: string | undefined
  borders?: Sides<BorderLook> | undefined
  tabs?: TabStop[] | undefined
}

/**
 * A figure of the file's list placed in a paragraph: in the line, or floating at a side of the text (`drop` down from
 * where it is anchored), or over or behind it at a place, from the page's corner or, across, from the text's left edge and, down, from the paragraph's top, the
 * text going on under it when it keeps its `room`. Its size is the size the file gives it; a drawing's picture may
 * reach past that box on each side (`bleed`), where its line, its arrows or its text do.
 */
export interface PlacedFigure {
  figure: number
  alt: string
  width?: number | undefined
  height?: number | undefined
  float?: 'left' | 'right' | undefined
  drop?: number | undefined
  at?: { x: number; y: number; from: 'page' | 'paragraph' } | undefined
  room?: boolean | undefined
  bleed?: Sides<number> | undefined
}

/** A box of text placed as a figure is: its size, fill, line, the rounding of its corners, and its paragraphs. */
export interface TextBox {
  width?: number | undefined
  height?: number | undefined
  float?: 'left' | 'right' | undefined
  drop?: number | undefined
  at?: { x: number; y: number; from: 'page' | 'paragraph' } | undefined
  room?: boolean | undefined
  fill?: string | undefined
  line?: BorderLook | undefined
  radius?: number | undefined
  insets: { top: number; right: number; bottom: number; left: number }
  blocks: DocumentBlock[]
}

/**
 * A piece of a paragraph: text, a tab (to a stop of its own when it names one), a line broken, the page's number or the count of pages (written where the page
 * is shown), a figure, a box of text, or the mark of a note, numbered, written as its label when the file numbers it otherwise (`i`, `ii`).
 */
export type DocumentSpan =
  | { text: string; look: TextLook; link?: string | undefined }
  | { tab: true; look: TextLook; stop?: TabStop | undefined }
  | { break: true }
  | { field: 'page' | 'pages'; look: TextLook }
  | { placed: PlacedFigure }
  | { box: TextBox }
  | { note: number; look: TextLook; label?: string | undefined }

/**
 * A paragraph: its look, its number or bullet (followed by a tab or not, and aligned at its first line's start, centred
 * on it or ending at it), its pieces, its heading level when it is one, and how its empty line is set.
 */
export interface DocumentParagraph {
  kind: 'paragraph'
  look: ParagraphLook
  marker?: { text: string; look: TextLook; tab: boolean; align?: 'left' | 'center' | 'right' | undefined } | undefined
  spans: DocumentSpan[]
  heading?: number | undefined
  mark: TextLook
}

/** A cell of a table: how many columns and rows it spans, its shading, borders, insets, how its content sits, and its content. */
export interface TableCell {
  columns: number
  rows: number
  shading?: string | undefined
  borders: Sides<BorderLook>
  insets: Sides<number>
  vertical?: 'top' | 'middle' | 'bottom' | undefined
  blocks: DocumentBlock[]
}

/** A table: its columns' widths, where it sits, and its rows, each with its height and cells. A cell merged into the one above is left out. */
export interface DocumentTable {
  kind: 'table'
  columns: number[]
  align?: 'left' | 'center' | 'right' | undefined
  indent?: number | undefined
  rows: { height?: { value: number; exact: boolean } | undefined; cells: TableCell[] }[]
}

export type DocumentBlock = DocumentParagraph | DocumentTable

/** A part of a page in its columns, as a section lays it out. */
export interface PageBand {
  columns: number
  gap: number
  blocks: DocumentBlock[]
}

/**
 * A page: its size, margins, the number it shows, its header and footer, the notes it shows at its foot, its content in
 * bands of columns, and where that content sits down the page when it does not fill it: at the top unless it says.
 */
export interface DocumentPage {
  width: number
  height: number
  number: string
  margins: { top: number; right: number; bottom: number; left: number; header: number; footer: number }
  header: DocumentBlock[]
  footer: DocumentBlock[]
  notes: { mark: number; blocks: DocumentBlock[] }[]
  bands: PageBand[]
  vertical?: 'middle' | 'bottom' | undefined
}

/** A whole document as it looks: its pages, the colour of its paper, its notes at its end, its default text and the distance between its default tab stops. */
export interface DocumentLook {
  pages: DocumentPage[]
  paper?: string | undefined
  endNotes: { mark: number; blocks: DocumentBlock[] }[]
  text: TextLook
  tab: number
}

/** A colour as the look keeps it, from six hexadecimal digits; none for anything else. */
export const colorOf = (value: string | undefined): string | undefined =>
  value !== undefined && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : undefined

/**
 * The bands of height a paragraph's figures and boxes keep across its text, in order down from its top: each one placed
 * from the paragraph that lets no text beside it (`room`), from its top to its bottom, its picture's reach included.
 * Bands that meet are one. Text that would meet a band goes on under it, as the app that wrote the file lays it out.
 */
export function keptRooms(spans: readonly DocumentSpan[]): { top: number; height: number }[] {
  const bands: { top: number; bottom: number }[] = []
  for (const span of spans) {
    const item = 'placed' in span ? span.placed : 'box' in span ? span.box : undefined
    if (!item?.room || item.at?.from !== 'paragraph') continue
    const bleed = 'bleed' in item ? item.bleed : undefined
    const top = Math.max(0, item.at.y - (bleed?.top ?? 0))
    const bottom = item.at.y + (item.height ?? 0) + (bleed?.bottom ?? 0)
    if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > top) bands.push({ top, bottom })
  }
  bands.sort((one, other) => one.top - other.top)
  const kept: { top: number; bottom: number }[] = []
  for (const band of bands) {
    const last = kept.at(-1)
    if (last && band.top <= last.bottom) last.bottom = Math.max(last.bottom, band.bottom)
    else kept.push({ ...band })
  }
  return kept.map(({ top, bottom }) => ({ top, height: bottom - top }))
}

/** A paragraph's look over another, its borders side by side. */
export function overParagraph(under: ParagraphLook, over: ParagraphLook): ParagraphLook {
  const merged: ParagraphLook = { ...under }
  for (const [key, value] of Object.entries(over) as [keyof ParagraphLook, ParagraphLook[keyof ParagraphLook]][])
    if (value !== undefined && key !== 'borders') (merged as Record<string, unknown>)[key] = value
  if (over.borders) merged.borders = { ...under.borders, ...over.borders }
  return merged
}
