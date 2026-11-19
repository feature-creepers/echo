/**
 * An OpenDocument text as it looks (docs/SPEC.md, section 9.7), read into `document-look.ts`: each paragraph and span
 * in its style over the ones it comes from and its family's default (`open-styles.ts`), lists numbered and bulleted as
 * their list style says at each level, tables with their columns, merged cells, borders, padding and backgrounds,
 * frames with their pictures, charts and text, its drawings (lines, shapes, groups) as pictures drawn as a
 * presentation's shapes are (`open-drawing.ts`), sections in their columns, and the pages of its master pages, with
 * their headers and footers, their numbers and footnotes. Pages break where the text breaks them and where the app that
 * saved it last broke them (`text:soft-page-break`), so a text LibreOffice saved shows its pages as it did.
 */

import { type Archive, textOf } from './archive.ts'
import type {
  BorderLook,
  DocumentBlock,
  DocumentLook,
  DocumentPage,
  DocumentParagraph,
  DocumentSpan,
  DocumentTable,
  PageBand,
  ParagraphLook,
  Sides,
  TableCell,
  TabStop,
  TextBox,
  TextLook
} from './document-look.ts'
import { colorOf } from './document-look.ts'
import { BLOCK_LIMIT, type PictureFigure } from './office-text.ts'
import { DRAWINGS, type DrawingSource, drawingSource, drawLoneShape, plainText } from './open-drawing.ts'
import { fontFaces, length, merged, type Properties, StyleBook, share } from './open-styles.ts'
import { listMark, symbolCharacter } from './word-look.ts'
import { childAt, childrenNamed, type XmlNode, xmlTree } from './xml.ts'

/** A length as OpenDocument writes it, in points. */
export const points = (value: string | undefined) => {
  const pixels = length(value)
  return pixels === undefined ? undefined : (pixels * 3) / 4
}

/** A colour as OpenDocument writes it (`#4472c4`); `transparent` gives none. */
const colorFrom = (value: string | undefined) => colorOf(value?.replace(/^#/, ''))

const UNDERLINES: Record<string, TextLook['underline']> = {
  solid: 'solid',
  dotted: 'dotted',
  dash: 'dashed',
  'long-dash': 'dashed',
  'dot-dash': 'dashed',
  'dot-dot-dash': 'dashed',
  wave: 'wavy'
}

/** A run's look while it is read: what the look keeps, and whether it is hidden. */
type RunRead = TextLook & { hidden?: boolean | undefined }

/** A run's look from the text properties of its style. */
export function textLook(properties: Properties, fonts: ReadonlyMap<string, string>): RunRead {
  const underline = properties['style:text-underline-style']
  const through = properties['style:text-line-through-style']
  const position = properties['style:text-position'] ?? ''
  const weight = properties['fo:font-weight']
  const size = points(properties['fo:font-size'])
  const raised = /^super|^[1-9]/.test(position.trim()) ? 'super' : /^sub|^-/.test(position.trim()) ? 'sub' : undefined
  return {
    font: fonts.get(properties['style:font-name'] ?? '') ?? properties['fo:font-family']?.replace(/^['"]|['"]$/g, '') ?? properties['style:font-name'],
    size: size !== undefined && size > 0 ? Math.round(Math.min(size, 400) * 100) / 100 : undefined,
    color: colorFrom(properties['fo:color']),
    bold: weight === undefined ? undefined : weight === 'bold' || Number(weight) >= 600,
    italic: properties['fo:font-style'] === undefined ? undefined : properties['fo:font-style'] !== 'normal',
    underline:
      underline === undefined || underline === 'none'
        ? undefined
        : properties['style:text-underline-type'] === 'double'
          ? 'double'
          : (UNDERLINES[underline] ?? 'solid'),
    struck: through === undefined ? undefined : through !== 'none',
    highlight: colorFrom(properties['fo:background-color']),
    position: raised,
    caps: properties['fo:text-transform'] === 'uppercase' ? 'all' : properties['fo:font-variant'] === 'small-caps' ? 'small' : undefined,
    spacing: points(properties['fo:letter-spacing']) || undefined,
    hidden: properties['text:display'] === 'none' ? true : undefined
  }
}

/** A border as OpenDocument writes one: `0.5pt solid #000000`; `none` is none. */
function borderOf(value: string | undefined): BorderLook | undefined {
  if (value === undefined) return undefined
  if (value.trim() === 'none' || value.trim() === 'hidden') return { width: 0, style: 'solid', color: '#000000' }
  const parts = value.trim().split(/\s+/)
  const width = parts.map(points).find((one) => one !== undefined) ?? (/thick/.test(value) ? 2.25 : /medium/.test(value) ? 1.5 : 0.75)
  const kind = parts.find((part) => /^(solid|double|dotted|dashed|groove|ridge|inset|outset)$/.test(part)) ?? 'solid'
  const color = colorFrom(parts.find((part) => part.startsWith('#'))) ?? '#000000'
  return { width: Math.max(width, 0.25), style: kind === 'double' ? 'double' : kind === 'dotted' ? 'dotted' : kind === 'dashed' ? 'dashed' : 'solid', color }
}

/** A shape's line as a border (`draw:stroke`), solid or dashed, a hairline as thin as a border shows; none when it has none. */
function strokeOf(properties: Properties): BorderLook | undefined {
  const stroke = properties['draw:stroke']
  if (stroke !== 'solid' && stroke !== 'dash') return undefined
  const width = Math.max(points(properties['svg:stroke-width']) ?? 0, 0.75)
  return { width, style: stroke === 'dash' ? 'dashed' : 'solid', color: colorFrom(properties['svg:stroke-color']) ?? '#000000' }
}

/** The borders the properties of a paragraph, a cell or a frame give, each side over all four. */
export function bordersOf(properties: Properties): Sides<BorderLook> {
  const all = properties['fo:border']
  return {
    top: borderOf(properties['fo:border-top'] ?? all),
    right: borderOf(properties['fo:border-right'] ?? all),
    bottom: borderOf(properties['fo:border-bottom'] ?? all),
    left: borderOf(properties['fo:border-left'] ?? all)
  }
}

function paddingOf(properties: Properties): Sides<number> {
  const all = properties['fo:padding']
  return {
    top: points(properties['fo:padding-top'] ?? all),
    right: points(properties['fo:padding-right'] ?? all),
    bottom: points(properties['fo:padding-bottom'] ?? all),
    left: points(properties['fo:padding-left'] ?? all)
  }
}

const ALIGNS: Record<string, ParagraphLook['align']> = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' }

function paragraphLook(properties: Properties): ParagraphLook {
  const height = properties['fo:line-height']
  const least = points(properties['style:line-height-at-least'])
  const multiple = share(height)
  const exact = points(height)
  return {
    align: ALIGNS[properties['fo:text-align'] ?? ''],
    start: points(properties['fo:margin-left']),
    end: points(properties['fo:margin-right']),
    firstLine: points(properties['fo:text-indent']),
    before: points(properties['fo:margin-top']),
    after: points(properties['fo:margin-bottom']),
    line:
      multiple !== undefined && multiple > 0
        ? { rule: 'multiple', value: multiple }
        : exact !== undefined && exact > 0
          ? { rule: 'exact', value: exact }
          : least !== undefined && least > 0
            ? { rule: 'least', value: least }
            : undefined,
    shading: colorFrom(properties['fo:background-color']),
    borders: properties['fo:border'] || properties['fo:border-top'] || properties['fo:border-bottom'] ? bordersOf(properties) : undefined
  }
}

/** What a page of a master page is laid out with: its size, margins, header and footer, and the format of its numbers. */
interface Master {
  width: number
  height: number
  margins: DocumentPage['margins']
  headers: { usual?: XmlNode | undefined; first?: XmlNode | undefined; even?: XmlNode | undefined }
  footers: { usual?: XmlNode | undefined; first?: XmlNode | undefined; even?: XmlNode | undefined }
  format: string
  paper?: string | undefined
  columns: { count: number; gap: number }
}

/** Where a list's level puts its number or bullet, and what the number is. */
interface ListLevel {
  format: string
  prefix: string
  suffix: string
  shown: number
  start: number
  bullet?: string | undefined
  bulletText: Properties
  indent?: { start: number; firstLine: number } | undefined
  followed: 'tab' | 'space' | 'nothing'
}

const NUMBER_FORMATS: Record<string, string> = { '1': 'decimal', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman' }

/** A place a frame or a drawing takes: in its line, floating at a side of the text, or at a place, the text going on under it or not. */
interface Placement {
  float?: 'left' | 'right' | undefined
  drop?: number | undefined
  at?: { x: number; y: number; from: 'page' | 'paragraph' } | undefined
  room?: boolean | undefined
}

/** How a text's look finds its figures: a frame's among those its text found, and a drawing added to them. */
type FrameFigure = (frame: XmlNode) => Promise<number | string | undefined>
type DrawingFigure = (drawing: PictureFigure) => number | undefined

class OpenReader {
  private readonly book: StyleBook
  private readonly fonts: Map<string, string>
  private readonly masters: Map<string, Master>
  private readonly figureOf: FrameFigure
  private readonly drawingOf: DrawingFigure
  private readonly drawings: DrawingSource
  private blocks = 0
  cut = false
  readonly pages: { master: Master; bands: PageBand[]; notes: DocumentPage['notes'] }[] = []
  private pending = true
  master: Master
  private readonly counters = new Map<string, number[]>()
  private noteQueue: DocumentPage['notes'] = []
  readonly endNotes: DocumentLook['endNotes'] = []
  private notes = 0
  private readonly pageFrames = new Map<number, DocumentSpan[]>()
  private readonly spaced = new WeakMap<DocumentParagraph, { style: string | undefined; contextual: boolean }>()

  /** Paragraphs of one style next to each other, where their style says so, have no space between them. */
  spaceContextually(blocks: DocumentBlock[]): void {
    blocks.forEach((block, index) => {
      const next = blocks[index + 1]
      if (block.kind !== 'paragraph' || next?.kind !== 'paragraph') return
      const one = this.spaced.get(block)
      const other = this.spaced.get(next)
      if (!one || !other || one.style !== other.style) return
      if (one.contextual) block.look.after = 0
      if (other.contextual) next.look.before = 0
    })
  }

  constructor(
    book: StyleBook,
    fonts: Map<string, string>,
    masters: Map<string, Master>,
    first: Master,
    figures: { frame: FrameFigure; drawing: DrawingFigure; source: DrawingSource }
  ) {
    this.book = book
    this.fonts = fonts
    this.masters = masters
    this.master = first
    this.figureOf = figures.frame
    this.drawingOf = figures.drawing
    this.drawings = figures.source
  }

  get full(): boolean {
    return this.blocks >= BLOCK_LIMIT
  }

  // Pages

  private get page() {
    if (this.pending || this.pages.length === 0) {
      this.pending = false
      const { count, gap } = this.master.columns
      this.pages.push({ master: this.master, bands: [{ columns: count, gap, blocks: [] }], notes: [] })
    }
    return this.pages.at(-1) as OpenReader['pages'][number]
  }

  place(block: DocumentBlock): void {
    const page = this.page
    page.bands.at(-1)?.blocks.push(block)
    page.notes.push(...this.noteQueue)
    this.noteQueue = []
  }

  /**
   * The next content goes on a new page, unless the page has none yet. Where the app that saved the text last broke a
   * page (`soft`) is passed over on a page that only holds empty paragraphs, as one after a hard break may.
   */
  breakPage(soft = false): void {
    const blocks = this.pages.at(-1)?.bands.flatMap((band) => band.blocks) ?? []
    const empty = blocks.every((block) => block.kind === 'paragraph' && block.spans.length === 0)
    if (blocks.length > 0 && !(soft && empty)) this.pending = true
  }

  /** A band of its own on the page for a section's columns, then back to the page's. */
  band(columns: { count: number; gap: number }): void {
    const page = this.page
    if (page.bands.at(-1)?.blocks.length === 0) page.bands.pop()
    page.bands.push({ columns: columns.count, gap: columns.gap, blocks: [] })
  }

  /** The frames anchored to pages by their number, put on those pages once they are known. */
  anchorFrames(): void {
    for (const [number, spans] of this.pageFrames) {
      const page = this.pages[Math.min(number, this.pages.length) - 1] ?? this.pages.at(-1)
      page?.bands[0]?.blocks.unshift({ kind: 'paragraph', look: {}, spans, mark: {} })
    }
  }

  // Styles

  private paragraphProperties(style: string | undefined, inMaster: boolean) {
    return {
      paragraph: this.book.properties('paragraph', style, 'paragraph', inMaster),
      text: this.book.properties('paragraph', style, 'text', inMaster)
    }
  }

  /** The tab stops a paragraph style gives, its own or the nearest it comes from, from its start indent as LibreOffice measures them. */
  private tabStops(style: string | undefined, inMaster: boolean, start: number): TabStop[] | undefined {
    for (const node of this.book.chain('paragraph', style, inMaster).reverse()) {
      const stops = childAt(node, 'style:paragraph-properties', 'style:tab-stops')
      if (!stops) continue
      return childrenNamed(stops, 'style:tab-stop').flatMap((stop): TabStop[] => {
        const position = points(stop.attributes['style:position'])
        if (position === undefined) return []
        const kind = stop.attributes['style:type'] ?? 'left'
        const leader =
          stop.attributes['style:leader-text'] ?? (stop.attributes['style:leader-style'] && stop.attributes['style:leader-style'] !== 'none' ? '.' : undefined)
        return [
          {
            position: position + start,
            align: kind === 'center' ? 'center' : kind === 'right' ? 'right' : kind === 'char' ? 'decimal' : 'left',
            leader: leader === '.' ? 'dot' : leader === '-' ? 'hyphen' : leader === '_' ? 'underscore' : undefined
          }
        ]
      })
    }
    return undefined
  }

  // Lists

  private listLevel(styleName: string | undefined, level: number): ListLevel | undefined {
    const style = styleName === undefined ? undefined : this.book.lists.get(styleName)
    const node = style?.children.find((child) => /^text:list-level-style-/.test(child.name) && Number(child.attributes['text:level'] ?? 1) === level)
    if (!node) return undefined
    const properties = childAt(node, 'style:list-level-properties')
    const alignment = childAt(properties, 'style:list-level-label-alignment')
    let indent: ListLevel['indent']
    if (alignment) {
      const start = points(alignment.attributes['fo:margin-left']) ?? 0
      indent = { start, firstLine: points(alignment.attributes['fo:text-indent']) ?? 0 }
    } else if (properties) {
      const before = points(properties.attributes['text:space-before']) ?? 0
      const label = points(properties.attributes['text:min-label-width']) ?? 0
      indent = { start: before + label, firstLine: -label }
    }
    const followed = alignment?.attributes['text:label-followed-by']
    const bulletStyle = node.attributes['text:style-name']
    const start = Number(node.attributes['text:start-value'] ?? 1)
    return {
      format: node.name === 'text:list-level-style-number' ? (node.attributes['style:num-format'] ?? '') : '',
      prefix: node.attributes['style:num-prefix'] ?? '',
      suffix: node.attributes['style:num-suffix'] ?? '',
      shown: Math.max(1, Number(node.attributes['text:display-levels'] ?? 1) || 1),
      start: Number.isFinite(start) ? start : 1,
      bullet: node.name === 'text:list-level-style-bullet' ? (node.attributes['text:bullet-char'] ?? '•') : undefined,
      bulletText: { ...this.book.properties('text', bulletStyle, 'text', false, false), ...(childAt(node, 'style:text-properties')?.attributes ?? {}) },
      indent,
      followed: followed === 'space' ? 'space' : followed === 'nothing' ? 'nothing' : 'tab'
    }
  }

  /** The mark of a list's next item at a level: its counters move on, and deeper ones start again. */
  private listMark(list: ListPlace, item: XmlNode): string | undefined {
    const level = this.listLevel(list.style, list.level)
    if (!level) return undefined
    if (level.bullet !== undefined) return level.bullet
    const counters = this.counters.get(list.key) ?? []
    const given = Number(item.attributes['text:start-value'])
    counters[list.level - 1] =
      Number.isFinite(given) && item.attributes['text:start-value'] !== undefined ? given : (counters[list.level - 1] ?? level.start - 1) + 1
    counters.length = list.level
    this.counters.set(list.key, counters)
    if (level.format === '') return `${level.prefix}${level.suffix}` || undefined
    const numbers: string[] = []
    for (let depth = list.level - level.shown + 1; depth <= list.level; depth++) {
      if (depth < 1) continue
      const at = depth === list.level ? level : this.listLevel(list.style, depth)
      numbers.push(listMark(NUMBER_FORMATS[at?.format ?? '1'] ?? 'decimal', counters[depth - 1] ?? at?.start ?? 1))
    }
    return `${level.prefix}${numbers.join('.')}${level.suffix}`
  }

  // Blocks

  /** The blocks of an element of a story: paragraphs, headings, lists, tables, sections, indexes, page breaks. */
  async readBlocks(node: XmlNode, inMaster: boolean, top: boolean, list?: ListPlace): Promise<DocumentBlock[]> {
    const blocks: DocumentBlock[] = []
    const add = (block: DocumentBlock) => {
      if (top) this.place(block)
      else blocks.push(block)
    }
    for (const child of node.children) {
      if (this.full) {
        this.cut = true
        break
      }
      switch (child.name) {
        case 'text:p':
        case 'text:h': {
          const style = child.attributes['text:style-name']
          const properties = this.paragraphProperties(style, inMaster)
          if (top) {
            const masterName = this.book.find('paragraph', style, inMaster)?.attributes['style:master-page-name']
            const master = masterName ? this.masters.get(masterName) : undefined
            if (master) {
              this.breakPage()
              this.master = master
            } else if (properties.paragraph['fo:break-before'] === 'page') this.breakPage()
          }
          const parts = await this.readParagraph(child, style, properties, inMaster, list)
          parts.forEach((part, index) => {
            if (index > 0 && top) this.breakPage()
            if (part) add(part)
          })
          if (top && properties.paragraph['fo:break-after'] === 'page') this.breakPage()
          break
        }
        case 'text:list': {
          const style = child.attributes['text:style-name'] ?? list?.style
          const level = (list?.level ?? 0) + 1
          // A list at the top starts its numbers again, unless it says it goes on from the one before.
          const key = list?.key ?? style ?? ''
          if (!list && child.attributes['text:continue-numbering'] !== 'true' && child.attributes['text:continue-list'] === undefined) this.counters.delete(key)
          for (const item of child.children) {
            if (item.name !== 'text:list-item' && item.name !== 'text:list-header') continue
            const place: ListPlace = { style, level, key, item: item.name === 'text:list-item' ? item : undefined }
            const read = await this.readBlocks(item, inMaster, top, place)
            blocks.push(...read)
          }
          break
        }
        case 'table:table': {
          if (top) {
            const properties = this.book.properties('table', child.attributes['table:style-name'], 'table', inMaster)
            if (properties['fo:break-before'] === 'page') this.breakPage()
          }
          const tables = await this.readTable(child, inMaster, top)
          tables.forEach((table, index) => {
            if (index > 0 && top) this.breakPage()
            add(table)
          })
          break
        }
        case 'text:section': {
          const properties = childAt(this.book.find('section', child.attributes['text:style-name'], inMaster), 'style:section-properties')
          const columns = childAt(properties, 'style:columns')
          const count = Math.min(Math.max(Number(columns?.attributes['fo:column-count']) || 1, 1), 12)
          if (top && count > 1) {
            this.band({ count, gap: points(columns?.attributes['fo:column-gap']) ?? 18 })
            await this.readBlocks(child, inMaster, top, list)
            this.band(this.master.columns)
          } else blocks.push(...(await this.readBlocks(child, inMaster, top, list)))
          break
        }
        case 'text:table-of-content':
        case 'text:illustration-index':
        case 'text:table-index':
        case 'text:object-index':
        case 'text:user-index':
        case 'text:alphabetical-index':
        case 'text:bibliography':
          blocks.push(...(await this.readBlocks(childAt(child, 'text:index-body') ?? child, inMaster, top, list)))
          break
        case 'text:index-title':
          blocks.push(...(await this.readBlocks(child, inMaster, top, list)))
          break
        case 'text:soft-page-break':
          if (top) this.breakPage(true)
          break
        default: {
          // A frame or a drawing at the top of the body is anchored to a page by its number.
          const placed = top ? linked(child) : undefined
          const span = placed && (await this.readPlaced(placed, inMaster))
          if (!placed || !span) break
          const number = Number(placed.attributes['text:anchor-page-number']) || 1
          this.pageFrames.set(number, [...(this.pageFrames.get(number) ?? []), span])
        }
      }
    }
    this.spaceContextually(blocks)
    return blocks
  }

  private async readParagraph(
    node: XmlNode,
    style: string | undefined,
    properties: { paragraph: Properties; text: Properties },
    inMaster: boolean,
    list: ListPlace | undefined
  ): Promise<(DocumentParagraph | undefined)[]> {
    this.blocks++
    let look = paragraphLook(properties.paragraph)
    const base = textLook(properties.text, this.fonts)
    const paragraph: DocumentParagraph = { kind: 'paragraph', look, spans: [], mark: strip(base) }
    if (node.name === 'text:h') paragraph.heading = Math.min(Math.max(Number(node.attributes['text:outline-level']) || 1, 1), 6)
    if (list) {
      const level = this.listLevel(list.style, list.level)
      if (level?.indent) look = { ...look, start: level.indent.start, firstLine: level.indent.firstLine }
      const mark =
        list.item && node === list.item.children.find((child) => child.name === 'text:p' || child.name === 'text:h')
          ? this.listMark(list, list.item)
          : undefined
      if (mark !== undefined && level) {
        const bullet = level.bullet !== undefined
        const markLook = { ...base, ...definedLook(textLook(level.bulletText, this.fonts)) }
        // A bullet of a font of symbols is the character it stands for, in the text's font.
        const shown = bullet ? [...mark].map((character) => symbolCharacter(markLook.font ?? '', character)).join('') : mark
        paragraph.marker = {
          text: level.followed === 'space' ? `${shown} ` : shown,
          look: strip(bullet ? { ...markLook, font: undefined } : markLook),
          tab: level.followed === 'tab'
        }
      }
    }
    look.tabs = this.tabStops(style, inMaster, look.start ?? 0)
    paragraph.look = look
    this.spaced.set(paragraph, { style: this.book.chosen('paragraph', style), contextual: properties.paragraph['style:contextual-spacing'] === 'true' })
    const pieces: (DocumentSpan | 'page')[] = []
    await this.readInline(node, properties.text, inMaster, pieces, undefined, { start: true })
    // A paragraph cut where a page breaks in it goes on without its number or the space before it.
    const runs: DocumentSpan[][] = [[]]
    for (const piece of pieces) {
      if (piece === 'page') runs.push([])
      else runs.at(-1)?.push(piece)
    }
    if (runs.length === 1) {
      paragraph.spans = trimmed(runs[0] ?? [])
      return [paragraph]
    }
    const firstShown = runs.findIndex((spans) => spans.length > 0)
    return runs.map((spans, index) => {
      if (spans.length === 0) return undefined
      const part: DocumentParagraph = { ...paragraph, look: { ...paragraph.look }, spans: trimmed(spans) }
      this.spaced.set(part, { style: this.book.chosen('paragraph', style), contextual: properties.paragraph['style:contextual-spacing'] === 'true' })
      if (index > firstShown) {
        part.look.before = 0
        part.look.firstLine = 0
        part.marker = undefined
      }
      if (index < runs.length - 1) part.look.after = 0
      return part
    })
  }

  /** The content of a paragraph or of what is in one (a span, a link), its pieces added to `pieces`. */
  private async readInline(
    node: XmlNode,
    text: Properties,
    inMaster: boolean,
    pieces: (DocumentSpan | 'page')[],
    link: string | undefined,
    line: { start: boolean }
  ): Promise<void> {
    const look = strip(textLook(text, this.fonts))
    const hidden = textLook(text, this.fonts).hidden === true
    const add = (span: DocumentSpan) => {
      if (!hidden) pieces.push(span)
    }
    for (const child of node.children) {
      switch (child.name) {
        case '#text': {
          // A run of white space is one space, none at a line's start: more are written as `text:s`.
          let written = child.text.replace(/\s+/g, ' ')
          if (line.start) written = written.replace(/^ /, '')
          if (written === '') break
          line.start = false
          add({ text: written, look, link })
          break
        }
        case 'text:s':
          add({ text: ' '.repeat(Math.min(Math.max(Number(child.attributes['text:c']) || 1, 1), 1000)), look, link })
          line.start = false
          break
        case 'text:tab':
          add({ tab: true, look })
          line.start = false
          break
        case 'text:line-break':
          add({ break: true })
          line.start = true
          break
        case 'text:span': {
          const own = this.book.properties('text', child.attributes['text:style-name'], 'text', inMaster, false)
          await this.readInline(child, merged([text, own]), inMaster, pieces, link, line)
          break
        }
        case 'text:a':
          await this.readInline(child, text, inMaster, pieces, child.attributes['xlink:href'] ?? link, line)
          break
        case 'text:page-number':
          add({ field: 'page', look })
          line.start = false
          break
        case 'text:page-count':
          add({ field: 'pages', look })
          line.start = false
          break
        case 'text:soft-page-break':
          pieces.push('page')
          break
        case 'text:note': {
          const body = childAt(child, 'text:note-body')
          if (!body || hidden) break
          const mark = ++this.notes
          pieces.push({ note: mark, look: { ...look, position: 'super' } })
          const blocks = await this.readBlocks(body, inMaster, false)
          // The note's own text starts with its mark.
          const first = blocks.find((block): block is DocumentParagraph => block.kind === 'paragraph')
          first?.spans.unshift({ note: mark, look: { ...first.mark, position: 'super' } })
          if (child.attributes['text:note-class'] === 'endnote') this.endNotes.push({ mark, blocks })
          else this.noteQueue.push({ mark, blocks })
          line.start = false
          break
        }
        case 'office:annotation':
        case 'office:annotation-end':
        case 'svg:title':
        case 'svg:desc':
        case 'text:note-citation':
        case 'text:tracked-changes':
        case 'text:bookmark':
        case 'text:bookmark-start':
        case 'text:bookmark-end':
        case 'text:reference-mark':
        case 'text:sequence-decls':
          break
        default: {
          // A frame or a drawing, linked or not, is placed as it says; fields and the like show their text, in the paragraph's look.
          const placed = linked(child)
          if (placed) {
            const span = await this.readPlaced(placed, inMaster)
            if (span) add(span)
          } else if (child.children.length > 0 && !child.name.startsWith('draw:')) await this.readInline(child, text, inMaster, pieces, link, line)
        }
      }
    }
  }

  /** A frame or a drawing, placed as its anchor and style say. */
  private readPlaced(node: XmlNode, inMaster: boolean): Promise<DocumentSpan | undefined> {
    return node.name === 'draw:frame' ? this.readFrame(node, inMaster) : this.readDrawing(node, inMaster)
  }

  /** A frame: its picture or chart, or its box of text, placed as its anchor and style say. */
  private async readFrame(frame: XmlNode, inMaster: boolean): Promise<DocumentSpan | undefined> {
    const width = points(frame.attributes['svg:width'])
    const height = points(frame.attributes['svg:height'] ?? frame.attributes['fo:min-height'])
    const placement = this.placement(frame, inMaster, { width: width ?? 0, height: height ?? 0 })
    const box = childAt(frame, 'draw:text-box')
    if (box) {
      const graphic = this.book.properties('graphic', frame.attributes['draw:style-name'], 'graphic', inMaster)
      const blocks = await this.readBlocks(box, inMaster, false)
      // Frames and drawings anchored to the frame itself sit in its box, placed from its first paragraph.
      const held: DocumentSpan[] = []
      for (const child of box.children) {
        const placed = linked(child)
        const span = placed && (await this.readPlaced(placed, inMaster))
        if (span) held.push(span)
      }
      const first = blocks[0]
      if (first?.kind === 'paragraph') first.spans.unshift(...held)
      else if (held.length > 0) blocks.unshift({ kind: 'paragraph', look: {}, spans: held, mark: {} })
      const minimum = points(box.attributes['fo:min-height'])
      // A frame's border, or the line a text box drawn as a shape is given, and the rounding of its corners.
      const line = borderOf(graphic['fo:border']) ?? strokeOf(graphic)
      const radius = points(box.attributes['draw:corner-radius'])
      const insets = paddingOf(graphic)
      const shown: TextBox = {
        width,
        height: height ?? minimum,
        ...placement,
        // A frame is filled only where its style says so: the shapes' fill colour of the default style is not its own.
        fill:
          graphic['draw:fill'] === 'solid'
            ? colorFrom(graphic['draw:fill-color'] ?? graphic['fo:background-color'])
            : graphic['draw:fill'] === undefined
              ? colorFrom(graphic['fo:background-color'])
              : undefined,
        line: line && line.width > 0 ? line : undefined,
        ...(radius !== undefined && radius > 0 ? { radius } : {}),
        insets: { top: insets.top ?? 0, right: insets.right ?? 0, bottom: insets.bottom ?? 0, left: insets.left ?? 0 },
        blocks
      }
      return { box: shown }
    }
    const figure = await this.figureOf(frame)
    if (figure === undefined) return undefined
    // An equation with no picture, as its linear text.
    if (typeof figure === 'string') return { text: figure, look: {} }
    const title = childAt(frame, 'svg:title') ?? childAt(frame, 'svg:desc')
    const alt = title?.children.map((one) => one.text).join('') ?? ''
    return { placed: { figure, alt, width, height, ...placement } }
  }

  /**
   * A drawing (a line, a shape, a group of them) as a picture of its own, drawn as a presentation's shapes are, its
   * fill, line, arrows and text as its style says; placed as its anchor and style say, by the box its shapes take, its
   * picture reaching past that box where its line, its arrows or its text do.
   */
  private async readDrawing(node: XmlNode, inMaster: boolean): Promise<DocumentSpan | undefined> {
    const drawing = await drawLoneShape(this.drawings, node, inMaster, Math.max(this.pages.length, 1)).catch(() => undefined)
    if (!drawing) return undefined
    const { box, reach } = drawing
    const pointsOf = (pixels: number) => (pixels * 3) / 4
    const alt = describedBy(node)
    const figure = this.drawingOf({
      kind: 'picture',
      type: 'image/svg+xml',
      bytes: drawing.svg,
      alt,
      width: Math.round(box.width + reach.left + reach.right),
      height: Math.round(box.height + reach.top + reach.bottom)
    })
    if (figure === undefined) return undefined
    const width = pointsOf(box.width)
    const height = pointsOf(box.height)
    const bleed = { top: pointsOf(reach.top), right: pointsOf(reach.right), bottom: pointsOf(reach.bottom), left: pointsOf(reach.left) }
    return { placed: { figure, alt, width, height, bleed, ...this.placement(node, inMaster, { x: pointsOf(box.x), y: pointsOf(box.y), width, height }) } }
  }

  /**
   * Where a frame or a drawing sits: in its line, floating by its wrapping and side, or at a place on the page or from
   * its paragraph, the text going on under it when it lets none beside it. Its box is its size and where it is from its
   * anchor, `svg:x` and `svg:y` unless given.
   */
  private placement(frame: XmlNode, inMaster: boolean, size: { x?: number; y?: number; width: number; height: number }): Placement {
    const anchor = frame.attributes['text:anchor-type'] ?? 'paragraph'
    if (anchor === 'as-char') return {}
    // A frame takes the frame styles it comes from; a drawing takes its own style alone.
    const graphic = this.book.properties('graphic', frame.attributes['draw:style-name'], 'graphic', inMaster, true, frame.name === 'draw:frame')
    const offsetX = size.x ?? points(frame.attributes['svg:x']) ?? 0
    const offsetY = size.y ?? points(frame.attributes['svg:y']) ?? 0
    const master = this.master
    const textWidth = master.width - master.margins.left - master.margins.right
    const relative = graphic['style:horizontal-rel'] ?? 'paragraph'
    const area = /^page/.test(relative) && relative !== 'page-content' ? { start: 0, width: master.width } : { start: master.margins.left, width: textWidth }
    const across = graphic['style:horizontal-pos'] ?? 'from-left'
    const x =
      across === 'center'
        ? area.start + (area.width - size.width) / 2
        : across === 'right' || across === 'outside'
          ? area.start + area.width - size.width
          : across === 'left' || across === 'inside'
            ? area.start
            : area.start + offsetX
    // A frame lets no text beside it unless its style says; Writer lets a drawing's text run through it.
    const wrap = graphic['style:wrap'] ?? (frame.name === 'draw:frame' ? 'none' : 'run-through')
    // Down from the page, its text's area or one of its margins (LibreOffice's own `loext:vertical-rel`), whatever it is anchored to.
    const down = graphic['loext:vertical-rel'] ?? graphic['style:vertical-rel'] ?? (anchor === 'page' ? 'page' : 'paragraph')
    if (anchor === 'page' || down === 'page' || down.startsWith('page-content')) {
      const { top, bottom } = master.margins
      const band =
        down === 'page-content'
          ? { start: top, height: master.height - top - bottom }
          : down === 'page-content-top'
            ? { start: 0, height: top }
            : down === 'page-content-bottom'
              ? { start: master.height - bottom, height: bottom }
              : { start: 0, height: master.height }
      const position = graphic['style:vertical-pos'] ?? 'from-top'
      const y =
        position === 'middle' || position === 'center'
          ? band.start + (band.height - size.height) / 2
          : position === 'bottom'
            ? band.start + band.height - size.height
            : position === 'top'
              ? band.start
              : band.start + offsetY
      return { at: { x, y, from: 'page' } }
    }
    if (wrap === 'none' && size.width >= textWidth * 0.9) return {}
    // A frame the text runs through sits over it; one with no text beside it keeps its room, the text going on under it.
    if (wrap === 'run-through') return { at: { x: x - master.margins.left, y: offsetY, from: 'paragraph' } }
    if (wrap === 'none') return { at: { x: x - master.margins.left, y: offsetY, from: 'paragraph' }, room: true }
    const float = wrap === 'left' || (wrap !== 'right' && x + size.width / 2 > master.width / 2) ? 'right' : 'left'
    return offsetY > 0 ? { float, drop: offsetY } : { float }
  }

  // Tables

  private async readTable(node: XmlNode, inMaster: boolean, top: boolean): Promise<DocumentTable[]> {
    const tableProperties = this.book.properties('table', node.attributes['table:style-name'], 'table', inMaster)
    const columns: number[] = []
    const columnElements = [
      ...node.children,
      ...childrenNamed(node, 'table:table-columns').flatMap((one) => one.children),
      ...childrenNamed(node, 'table:table-header-columns').flatMap((one) => one.children)
    ]
    for (const column of columnElements) {
      if (column.name !== 'table:table-column') continue
      const width = points(this.book.properties('table-column', column.attributes['table:style-name'], 'table-column', inMaster)['style:column-width']) ?? 0
      const repeated = Math.min(Math.max(Number(column.attributes['table:number-columns-repeated']) || 1, 1), 64)
      for (let at = 0; at < repeated && columns.length < 64; at++) columns.push(width)
    }
    const rows: DocumentTable['rows'] = []
    const heads: DocumentTable['rows'] = []
    const breaks: number[] = []
    const readRows = async (holder: XmlNode, heading: boolean) => {
      for (const row of holder.children) {
        if (row.name === 'table:table-header-rows') await readRows(row, true)
        else if (row.name === 'table:table-rows') await readRows(row, false)
        else if (row.name === 'text:soft-page-break' && top && rows.length > 0) breaks.push(rows.length)
        else if (row.name === 'table:table-row') {
          if (this.full) {
            this.cut = true
            return
          }
          this.blocks++
          const rowProperties = this.book.properties('table-row', row.attributes['table:style-name'], 'table-row', inMaster)
          const exact = points(rowProperties['style:row-height'])
          const least = points(rowProperties['style:min-row-height'])
          const cells: TableCell[] = []
          for (const cell of row.children) {
            if (cell.name !== 'table:table-cell') continue
            const properties = this.book.properties('table-cell', cell.attributes['table:style-name'], 'table-cell', inMaster)
            const vertical = properties['style:vertical-align']
            const padding = paddingOf(properties)
            cells.push({
              columns: Math.min(Math.max(Number(cell.attributes['table:number-columns-spanned']) || 1, 1), 64),
              rows: Math.min(Math.max(Number(cell.attributes['table:number-rows-spanned']) || 1, 1), 1000),
              shading: colorFrom(properties['fo:background-color']),
              borders: bordersOf(properties),
              insets: { top: padding.top ?? 0, right: padding.right ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0 },
              vertical: vertical === 'middle' ? 'middle' : vertical === 'bottom' ? 'bottom' : undefined,
              blocks: await this.readBlocks(cell, inMaster, false)
            })
          }
          const read = { height: exact ? { value: exact, exact: true } : least ? { value: least, exact: false } : undefined, cells }
          rows.push(read)
          if (heading) heads.push(read)
        }
      }
    }
    await readRows(node, false)
    const align = tableProperties['table:align']
    const width = points(tableProperties['style:width'])
    const total = columns.reduce((sum, one) => sum + one, 0)
    // Columns whose widths do not add up to the table's are scaled to it.
    const scale = width && total > 0 && Math.abs(width - total) > 1 ? width / total : 1
    const table = (part: DocumentTable['rows']): DocumentTable => ({
      kind: 'table',
      columns: columns.map((one) => one * scale),
      align: align === 'center' ? 'center' : align === 'right' ? 'right' : undefined,
      indent: align === 'margins' || align === 'left' || align === undefined ? points(tableProperties['fo:margin-left']) || undefined : undefined,
      rows: part
    })
    if (breaks.length === 0) return [table(rows)]
    const tables: DocumentTable[] = []
    let from = 0
    for (const end of [...breaks, rows.length]) {
      const part = rows
        .slice(from, end)
        .map((row, offset) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, rows: Math.min(cell.rows, end - from - offset) })) }))
      tables.push(table(from > 0 ? [...heads, ...part] : part))
      from = end
    }
    return tables
  }

  // Headers and footers

  private readonly stories = new Map<XmlNode, Promise<DocumentBlock[]>>()

  storyBlocks(node: XmlNode | undefined): Promise<DocumentBlock[]> {
    if (!node || node.attributes['style:display'] === 'false') return Promise.resolve([])
    let read = this.stories.get(node)
    if (!read) {
      read = this.readBlocks(node, true, false)
      this.stories.set(node, read)
    }
    return read
  }
}

/** Where a paragraph is in a list: the list's style, its level from 1, the counters it shares, and the item it starts. */
interface ListPlace {
  style: string | undefined
  level: number
  key: string
  item: XmlNode | undefined
}

/** The frame or drawing an element places: itself, or the one a link (`draw:a`) holds; none for anything else. */
function linked(node: XmlNode): XmlNode | undefined {
  if (node.name === 'draw:frame' || DRAWINGS.has(node.name)) return node
  return node.name === 'draw:a' ? node.children.find((child) => child.name === 'draw:frame' || DRAWINGS.has(child.name)) : undefined
}

/** A drawing's words: its title or description, else the text written in its shapes. */
function describedBy(node: XmlNode): string {
  const title = childAt(node, 'svg:title') ?? childAt(node, 'svg:desc')
  if (title) return plainText(title).trim()
  const words: string[] = []
  const gather = (from: XmlNode) => {
    for (const child of from.children) {
      if (child.name === 'text:p' || child.name === 'text:h') words.push(plainText(child).replace(/\s+/g, ' ').trim())
      else if (DRAWINGS.has(child.name) || child.name === 'draw:frame' || child.name === 'draw:text-box') gather(child)
    }
  }
  gather(node)
  return words.filter(Boolean).join(' ').slice(0, 1000)
}

/** A run's look as the look keeps it. */
function strip(look: RunRead): TextLook {
  const { hidden: _hidden, ...kept } = look
  return kept
}

/** What a look sets, without what it leaves to the look under it. */
export const definedLook = (look: TextLook): TextLook => Object.fromEntries(Object.entries(look).filter(([, one]) => one !== undefined)) as TextLook

/** A paragraph's pieces without the space a line ends with before its end. */
function trimmed(spans: DocumentSpan[]): DocumentSpan[] {
  const last = spans.at(-1)
  if (last && 'text' in last && / $/.test(last.text)) {
    const text = last.text.replace(/ +$/, '')
    return text === '' ? spans.slice(0, -1) : [...spans.slice(0, -1), { ...last, text }]
  }
  return spans
}

/** A master page's layout: the size and margins of its page layout, the room its header and footer take, and its header's and footer's content. */
function masterOf(master: XmlNode, layouts: ReadonlyMap<string, XmlNode>): Master {
  const layout = layouts.get(master.attributes['style:page-layout-name'] ?? '')
  const page = childAt(layout, 'style:page-layout-properties')?.attributes ?? {}
  const width = Math.min(Math.max(points(page['fo:page-width']) ?? 595.3, 36), 1584)
  const height = Math.min(Math.max(points(page['fo:page-height']) ?? 841.9, 36), 1584)
  const margin = (name: string, fallback: number) => Math.min(Math.max(points(page[name] ?? page['fo:margin']) ?? fallback, 0), Math.min(width, height) / 2)
  const header = childAt(layout, 'style:header-style', 'style:header-footer-properties')?.attributes
  const footer = childAt(layout, 'style:footer-style', 'style:header-footer-properties')?.attributes
  const top = margin('fo:margin-top', 56.7)
  const bottom = margin('fo:margin-bottom', 56.7)
  const shows = (name: string) => {
    const found = childAt(master, name)
    return found !== undefined && found.attributes['style:display'] !== 'false'
  }
  // A header takes room above the text: its height and the space under it, from the page's margin.
  const headerRoom = shows('style:header')
    ? (points(header?.['svg:height'] ?? header?.['fo:min-height']) ?? 0) + (points(header?.['fo:margin-bottom']) ?? 0)
    : 0
  const footerRoom = shows('style:footer') ? (points(footer?.['svg:height'] ?? footer?.['fo:min-height']) ?? 0) + (points(footer?.['fo:margin-top']) ?? 0) : 0
  const columns = childAt(layout, 'style:page-layout-properties', 'style:columns')
  return {
    width,
    height,
    margins: {
      top: top + headerRoom,
      bottom: bottom + footerRoom,
      left: margin('fo:margin-left', 56.7),
      right: margin('fo:margin-right', 56.7),
      header: top,
      footer: bottom
    },
    headers: { usual: childAt(master, 'style:header'), first: childAt(master, 'style:header-first'), even: childAt(master, 'style:header-left') },
    footers: { usual: childAt(master, 'style:footer'), first: childAt(master, 'style:footer-first'), even: childAt(master, 'style:footer-left') },
    format: page['style:num-format'] ?? '1',
    paper: colorFrom(page['fo:background-color']),
    columns: { count: Math.min(Math.max(Number(columns?.attributes['fo:column-count']) || 1, 1), 12), gap: points(columns?.attributes['fo:column-gap']) ?? 18 }
  }
}

/**
 * An OpenDocument text's look: its pages as its master pages lay them out and as it last broke them, each with its
 * header, footer and footnotes, and its endnotes at the end. Its frames' figures are found by `figureOf`, among those
 * of its text, and its drawings are added to them by `drawingOf`.
 */
export async function readOpenLook(
  archive: Archive,
  contentXml: string,
  figureOf: FrameFigure,
  drawingOf: DrawingFigure = () => undefined
): Promise<{ look: DocumentLook; cut: boolean } | undefined> {
  const document = childAt(xmlTree(contentXml), 'office:document-content')
  const body = childAt(document, 'office:body', 'office:text')
  if (!body) return undefined
  const stylesRoot = childAt(xmlTree((await textOf(archive, 'styles.xml')) ?? ''), 'office:document-styles')
  const book = new StyleBook(childAt(document, 'office:automatic-styles'), childAt(stylesRoot, 'office:automatic-styles'), childAt(stylesRoot, 'office:styles'))
  const fonts = fontFaces([stylesRoot, document])
  const layouts = new Map<string, XmlNode>()
  for (const layout of childrenNamed(childAt(stylesRoot, 'office:automatic-styles'), 'style:page-layout'))
    layouts.set(layout.attributes['style:name'] ?? '', layout)
  const masters = new Map<string, Master>()
  for (const master of childrenNamed(childAt(stylesRoot, 'office:master-styles'), 'style:master-page'))
    masters.set(master.attributes['style:name'] ?? '', masterOf(master, layouts))
  // The first page's master is the one its first paragraph's style names, else the standard one.
  const firstParagraph = body.children.find((child) => child.name === 'text:p' || child.name === 'text:h')
  const firstMaster = book.find('paragraph', firstParagraph?.attributes['text:style-name'], false)?.attributes['style:master-page-name']
  const first =
    masters.get(firstMaster ?? '') ??
    masters.get('Standard') ??
    [...masters.values()][0] ??
    masterOf({ name: '', attributes: {}, children: [], text: '' }, layouts)
  const reader = new OpenReader(book, fonts, masters, first, {
    frame: figureOf,
    drawing: drawingOf,
    // Writer draws a text's shapes in their own style alone, not the frame styles it may name.
    source: await drawingSource(archive, book, fonts, stylesRoot, false)
  })
  await reader.readBlocks(body, false, true)
  if (reader.pages.length === 0) reader.place({ kind: 'paragraph', look: {}, spans: [], mark: {} })
  for (const page of reader.pages) for (const band of page.bands) reader.spaceContextually(band.blocks)
  reader.anchorFrames()

  const pages: DocumentPage[] = []
  let previous: Master | undefined
  for (const [index, page] of reader.pages.entries()) {
    const { master } = page
    const firstOfMaster = master !== previous
    previous = master
    const number = index + 1
    const even = number % 2 === 0
    const header = (firstOfMaster && master.headers.first) || (even && master.headers.even) || master.headers.usual
    const footer = (firstOfMaster && master.footers.first) || (even && master.footers.even) || master.footers.usual
    pages.push({
      width: master.width,
      height: master.height,
      number: listMark(NUMBER_FORMATS[master.format] ?? 'decimal', number),
      margins: master.margins,
      header: await reader.storyBlocks(header),
      footer: await reader.storyBlocks(footer),
      notes: page.notes,
      bands: page.bands.filter((band, at) => band.blocks.length > 0 || at === 0)
    })
  }
  const text = strip(textLook(book.properties('paragraph', 'Standard', 'text', false), fonts))
  const tab = points(book.properties('paragraph', 'Standard', 'paragraph', false)['style:tab-stop-distance'])
  return { look: { pages, paper: first.paper, endNotes: reader.endNotes, text, tab: Math.min(Math.max(tab ?? 35.4, 9), 288) }, cut: reader.cut }
}
