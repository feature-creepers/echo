/**
 * A document shown as it looks (docs/SPEC.md, section 9.7): each page a sheet at its size and margins, scaled to fit
 * the pane, with its header, its content in its columns, its footnotes and its footer; each paragraph and run in its
 * look. It is made of the window's own elements, its text escaped as any text is, its colours checked when they were
 * read, its fonts named and never fetched, its pictures from their own bytes: nothing in it runs or reaches out.
 */

import { type CSSProperties, createContext, Fragment, type ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react'
import {
  type BorderLook,
  type DocumentBlock,
  type DocumentLook,
  type DocumentPage,
  type DocumentParagraph,
  type DocumentSpan,
  type DocumentTable,
  keptRooms,
  type PlacedFigure,
  type Sides,
  type TabStop,
  type TextBox,
  type TextLook
} from './document-look.ts'
import { Figure } from './figure-view.tsx'
import type { OfficeFigure, SheetFigure } from './office-text.ts'
import { fontStack } from './slide-svg.ts'

/** A length in points, as CSS takes it. */
const pt = (value: number) => `${Math.round(value * 100) / 100}pt`

/** How tall a font's single line is for its size, as Word sets it: the font's own ascent, descent and gap. */
const LINE_RATIOS: [RegExp, number][] = [
  [/calibri|carlito/i, 1.22],
  [/aptos/i, 1.2],
  [/cambria|caladea/i, 1.17],
  [/segoe/i, 1.33],
  [/verdana/i, 1.22],
  [/georgia/i, 1.14],
  [/courier|liberation mono/i, 1.13],
  [/arial|helvetica|liberation sans|times|liberation serif/i, 1.15]
]
const lineRatio = (font: string | undefined) => LINE_RATIOS.find(([pattern]) => pattern.test(font ?? ''))?.[1] ?? 1.17

/** What every part of a page is shown with: the file's figures and their addresses, the page's number, the count of pages and the distance between default tab stops. */
interface Shown {
  figures: readonly OfficeFigure[]
  urls: ReadonlyMap<OfficeFigure, string>
  page: string
  pages: number
  tab: number
}

const ShownContext = createContext<Shown>({ figures: [], urls: new Map(), page: '1', pages: 1, tab: 36 })

function textStyle(look: TextLook): CSSProperties {
  const lines = [look.underline ? 'underline' : '', look.struck ? 'line-through' : ''].filter(Boolean).join(' ')
  const shifted = look.position !== undefined
  return {
    fontFamily: look.font ? fontStack(look.font) : undefined,
    fontSize: look.size !== undefined ? pt(shifted ? look.size * 0.65 : look.size) : shifted ? '65%' : undefined,
    color: look.color,
    fontWeight: look.bold ? 700 : 400,
    fontStyle: look.italic ? 'italic' : 'normal',
    textDecorationLine: lines || undefined,
    textDecorationStyle: look.underline && look.underline !== 'solid' ? look.underline : undefined,
    backgroundColor: look.highlight,
    verticalAlign: look.position,
    textTransform: look.caps === 'all' ? 'uppercase' : undefined,
    fontVariantCaps: look.caps === 'small' ? 'small-caps' : undefined,
    letterSpacing: look.spacing !== undefined ? pt(look.spacing) : undefined
  }
}

const borderCss = (border: BorderLook | undefined) => (border && border.width > 0 ? `${pt(border.width)} ${border.style} ${border.color}` : undefined)

function bordersStyle(borders: Sides<BorderLook> | undefined): CSSProperties {
  return {
    borderTop: borderCss(borders?.top),
    borderRight: borderCss(borders?.right),
    borderBottom: borderCss(borders?.bottom),
    borderLeft: borderCss(borders?.left)
  }
}

/** The height of a paragraph's lines: a multiple of a single line of its font, exactly a height, or at least one. */
function lineHeight(paragraph: DocumentParagraph): CSSProperties['lineHeight'] {
  const { line } = paragraph.look
  const ratio = lineRatio(paragraph.mark.font)
  if (!line || line.rule === 'multiple') {
    const multiple = line?.value ?? 1
    return Math.abs(multiple - 1) < 0.01 ? 'normal' : Math.round(multiple * ratio * 1000) / 1000
  }
  return line.rule === 'exact' ? pt(line.value) : `max(${pt(line.value)}, ${ratio}em)`
}

const sameBorder = (one: BorderLook | undefined, other: BorderLook | undefined) =>
  one?.width === other?.width && one?.style === other?.style && one?.color === other?.color

/**
 * Whether two paragraphs one under the other are boxed together, as Word boxes them: both bordered, with the same
 * borders at the same indents.
 */
function boxedTogether(one: DocumentBlock | undefined, other: DocumentBlock | undefined): boolean {
  if (one?.kind !== 'paragraph' || other?.kind !== 'paragraph') return false
  const [first, second] = [one.look.borders, other.look.borders]
  if (!first || !second || (one.look.start ?? 0) !== (other.look.start ?? 0) || (one.look.end ?? 0) !== (other.look.end ?? 0)) return false
  return (['top', 'right', 'bottom', 'left'] as const).every((side) => sameBorder(first[side], second[side])) && Object.values(first).some(Boolean)
}

/**
 * Blocks one under the other, the space after one and before the next added together, as Word adds them. Paragraphs
 * with the same borders make one box, as in Word: its top line above the first, its bottom line under the last, its
 * sides and shading running through the space between them.
 */
function Blocks({ blocks }: { blocks: readonly DocumentBlock[] }) {
  return blocks.map((block, index) => {
    const previous = blocks[index - 1]
    const above = (previous?.kind === 'paragraph' ? (previous.look.after ?? 0) : 0) + (block.kind === 'paragraph' ? (block.look.before ?? 0) : 0)
    const below = index === blocks.length - 1 && block.kind === 'paragraph' ? (block.look.after ?? 0) : 0
    const boxed = { above: boxedTogether(previous, block), below: boxedTogether(block, blocks[index + 1]) }
    return block.kind === 'paragraph' ? (
      <Paragraph key={index} paragraph={block} above={above} below={below} boxed={boxed} />
    ) : (
      <Table key={index} table={block} above={above} />
    )
  })
}

function Paragraph({
  paragraph,
  above,
  below,
  boxed = { above: false, below: false }
}: {
  paragraph: DocumentParagraph
  above: number
  below: number
  boxed?: { above: boolean; below: boolean }
}) {
  const shown = useContext(ShownContext)
  const { look, mark, marker } = paragraph
  const hanging = (look.firstLine ?? 0) < 0 ? -(look.firstLine ?? 0) : 0
  // A number's tab goes to the text's start when the first line hangs before it, else on to the next default tab stop.
  const firstStart = Math.max(0, (look.start ?? 0) + (look.firstLine ?? 0))
  const markerWidth = hanging > 0 ? hanging : (Math.floor(firstStart / shown.tab) + 1) * shown.tab - firstStart
  const style: CSSProperties = {
    position: 'relative',
    margin: 0,
    // Within a box of paragraphs, the space between two is inside it, so that its sides run on.
    marginTop: above && !boxed.above ? pt(above) : undefined,
    paddingTop: above && boxed.above ? pt(above) : undefined,
    marginBottom: below ? pt(below) : undefined,
    textAlign: look.align,
    paddingLeft: look.start ? pt(look.start) : undefined,
    paddingRight: look.end ? pt(look.end) : undefined,
    textIndent: look.firstLine ? pt(look.firstLine) : undefined,
    lineHeight: lineHeight(paragraph),
    backgroundColor: look.shading,
    ...bordersStyle({ ...look.borders, top: boxed.above ? undefined : look.borders?.top, bottom: boxed.below ? undefined : look.borders?.bottom }),
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    tabSize: pt(shown.tab),
    fontFamily: mark.font ? fontStack(mark.font) : undefined,
    fontSize: mark.size !== undefined ? pt(mark.size) : undefined
  }
  const tabbed = paragraph.spans.some((span) => 'tab' in span && (span.stop !== undefined || (look.tabs?.length ?? 0) > 0))
  // A number aligned at the right or the centre ends at, or sits across, the first line's start, its tab going on to the text's.
  const markerShown =
    marker &&
    (marker.align === undefined ? (
      <span
        style={{
          ...textStyle(marker.look),
          display: 'inline-block',
          boxSizing: 'border-box',
          textIndent: 0,
          minWidth: marker.tab ? pt(markerWidth) : undefined,
          paddingRight: marker.tab ? '0.4em' : undefined,
          whiteSpace: 'pre'
        }}
      >
        {marker.text}
      </span>
    ) : (
      <span style={{ display: 'inline-block', position: 'relative', textIndent: 0, width: marker.tab ? pt(markerWidth) : 0 }}>
        <span
          style={{
            ...textStyle(marker.look),
            position: 'absolute',
            top: 0,
            whiteSpace: 'pre',
            ...(marker.align === 'right' ? { right: '100%' } : { left: 0, transform: 'translateX(-50%)' })
          }}
        >
          {marker.text}
        </span>
        {'\u200b'}
      </span>
    ))
  const heading = paragraph.heading === undefined ? {} : { role: 'heading', 'aria-level': paragraph.heading }
  const anchored = paragraph.spans.filter(fromParagraph)
  const flowing = anchored.length > 0 ? paragraph.spans.filter((span) => !fromParagraph(span)) : paragraph.spans
  // A first line that hangs before the text, its number typed before a tab, goes on to the text's start at that tab as
  // a list's number does: Word passes over the default stops before the text's start. A longer lead goes on to the
  // next default stop after it.
  const firstTab = flowing.findIndex((span) => 'tab' in span)
  const lead =
    hanging > 0 && !marker && !tabbed && firstTab > 0 && firstTab <= 4 && flowing.slice(0, firstTab).every((span) => 'text' in span && span.text.length <= 24)
      ? firstTab + 1
      : 0
  const spans = flowing.map((span, index) => <Span key={index} span={span} />)
  return (
    <div style={style} {...heading}>
      {anchored.length > 0 && <Anchored spans={anchored} />}
      {markerShown}
      {tabbed ? (
        <TabbedSpans paragraph={{ ...paragraph, spans: flowing }} />
      ) : lead > 0 ? (
        <>
          <span style={{ display: 'inline-block', minWidth: pt(hanging), textIndent: 0, whiteSpace: 'pre' }}>{spans.slice(0, lead)}</span>
          {spans.slice(lead)}
        </>
      ) : (
        spans
      )}
      {/* An empty paragraph still makes a line, as tall as its mark's font, even when figures are placed from it. */}
      {flowing.length === 0 && <span style={textStyle(mark)}>{'​'}</span>}
    </div>
  )
}

/** Whether a span is a figure or a box placed at a place from its paragraph, rather than in its lines. */
const fromParagraph = (span: DocumentSpan) => ('placed' in span && span.placed.at?.from === 'paragraph') || ('box' in span && span.box.at?.from === 'paragraph')

/**
 * The figures and boxes placed from a paragraph, measured from its first line: where an earlier figure's room pushes
 * that line down, they go down with it, as the app that wrote the file moves the paragraph. A mark of almost no width
 * starts the line, so even an empty one cannot sit beside a room as wide as the text, and the rooms and figures after
 * it start no higher than it.
 */
function Anchored({ spans }: { spans: readonly DocumentSpan[] }) {
  return (
    <>
      <span aria-hidden="true" style={{ display: 'inline-block', width: '0.1px', height: 0, verticalAlign: 'top' }} />
      <Rooms spans={spans} />
      {spans.map((span, index) => ('placed' in span ? <Placed key={index} placed={span.placed} /> : 'box' in span ? <Box key={index} box={span.box} /> : null))}
    </>
  )
}

/**
 * The room a paragraph's figures keep across its text where they let none beside them: for each band, an empty float
 * as high as the space above it, then one as wide as the text and as high as the band, under it. Lines that would meet
 * a band go on under it, in this paragraph and those after it, while those above it stay where they are.
 */
function Rooms({ spans }: { spans: readonly DocumentSpan[] }) {
  let reached = 0
  return keptRooms(spans).map((room, index) => {
    const above = room.top - reached
    reached = room.top + room.height
    return (
      <Fragment key={index}>
        <span aria-hidden="true" style={{ display: 'block', float: 'left', clear: index > 0 ? 'left' : undefined, width: 0, height: pt(above) }} />
        <span aria-hidden="true" style={{ display: 'block', float: 'left', clear: 'left', width: '100%', height: pt(room.height) }} />
      </Fragment>
    )
  })
}

/**
 * A paragraph whose tabs go to stops of its own: its text before the first tab where it is, each piece after a tab at
 * its stop, aligned to it as the stop says, the space before it filled with the stop's leader. Each tab goes to the
 * next stop after the one before it, the default ones after the paragraph's own.
 */
function TabbedSpans({ paragraph }: { paragraph: DocumentParagraph }) {
  const shown = useContext(ShownContext)
  const pieces: { stop: TabStop | undefined; spans: DocumentSpan[] }[] = [{ stop: undefined, spans: [] }]
  let reached = paragraph.look.start ?? 0
  for (const span of paragraph.spans) {
    if (!('tab' in span)) {
      pieces.at(-1)?.spans.push(span)
      continue
    }
    const stop = span.stop ??
      paragraph.look.tabs?.find((one) => one.position > reached + 0.5) ?? {
        position: (Math.floor(reached / shown.tab) + 1) * shown.tab,
        align: 'left'
      }
    reached = stop.position
    pieces.push({ stop, spans: [] })
  }
  const covered: CSSProperties = { position: 'relative', zIndex: 1, backgroundColor: 'var(--paper)' }
  return pieces.map(({ stop, spans }, index) => {
    const content = spans.map((span, at) => <Span key={at} span={span} />)
    if (!stop) return <span key={index}>{content.length > 0 ? <span style={covered}>{content}</span> : null}</span>
    const from = pieces[index - 1]?.stop?.position ?? 0
    const shift = stop.align === 'right' || stop.align === 'decimal' ? 'translateX(-100%)' : stop.align === 'center' ? 'translateX(-50%)' : undefined
    const leader = stop.leader === 'dot' ? '. ' : stop.leader === 'hyphen' ? '- ' : stop.leader === 'underscore' ? '_' : undefined
    return (
      <span key={index}>
        {leader && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: pt(from),
              width: pt(Math.max(0, stop.position - from)),
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textIndent: 0,
              direction: 'rtl'
            }}
          >
            {leader.repeat(400)}
          </span>
        )}
        <span style={{ ...covered, position: 'absolute', top: 0, left: pt(stop.position), transform: shift, whiteSpace: 'pre', textIndent: 0 }}>{content}</span>
      </span>
    )
  })
}

function Span({ span }: { span: DocumentSpan }) {
  const shown = useContext(ShownContext)
  if ('text' in span) return <span style={textStyle(span.look)}>{span.text}</span>
  if ('tab' in span) return <span style={textStyle(span.look)}>{'\t'}</span>
  if ('break' in span) return <br />
  if ('field' in span) return <span style={textStyle(span.look)}>{span.field === 'page' ? shown.page : String(shown.pages)}</span>
  if ('note' in span) return <span style={textStyle(span.look)}>{span.label ?? String(span.note)}</span>
  if ('placed' in span) return span.placed.at?.from === 'page' ? null : <Placed placed={span.placed} />
  return span.box.at?.from === 'page' ? null : <Box box={span.box} />
}

/** How a figure or a box floats at a side of the text, and how far down from where it is anchored. */
interface Floating {
  float?: 'left' | 'right' | undefined
  drop?: number | undefined
}

/**
 * An empty float as high as a float's drop, at its side, before it: the lines above the float keep their width, and it
 * floats from under the empty one.
 */
function Drop({ item }: { item: Floating }) {
  return item.float && item.drop ? <span aria-hidden="true" style={{ display: 'block', float: item.float, width: 0, height: pt(item.drop) }} /> : null
}

/**
 * Where a figure or a box sits: in its line, floating at a side of the text, or over it at a place: from the page's
 * corner, or from its paragraph's first line, down from where that line starts.
 */
function placement(item: Floating & { at?: { x: number; y: number; from: 'page' | 'paragraph' } | undefined }): CSSProperties {
  if (item.at?.from === 'paragraph') return { position: 'absolute', left: pt(item.at.x), marginTop: pt(item.at.y) }
  if (item.at) return { position: 'absolute', left: pt(item.at.x), top: pt(item.at.y) }
  if (item.float) return { float: item.float, clear: item.drop ? item.float : undefined, margin: item.float === 'left' ? '0 9pt 0 0' : '0 0 0 9pt' }
  return { display: 'inline-block', verticalAlign: 'bottom' }
}

/** A worksheet held as an object, scaled to the size its document gives its picture, as Word scales the picture. */
function fitted(figure: SheetFigure, placed: PlacedFigure): SheetFigure {
  const width = figure.look.columns.reduce((sum, one) => sum + one, 0)
  const height = figure.look.rows.reduce((sum, one) => sum + one, 0)
  const scales = [placed.width && width > 0 ? placed.width / width : undefined, placed.height && height > 0 ? placed.height / height : undefined].filter(
    (scale): scale is number => scale !== undefined && Number.isFinite(scale) && scale > 0
  )
  if (scales.length === 0) return figure
  // A little under, so rounding never leaves the sheet wider than its place.
  const zoom = Math.floor(Math.min(...scales) * 1000) / 1000
  return { ...figure, look: { ...figure.look, zoom } }
}

function Placed({ placed }: { placed: PlacedFigure }) {
  const { figures, urls } = useContext(ShownContext)
  const figure = figures[placed.figure]
  if (!figure) return null
  const size: CSSProperties = { width: placed.width ? pt(placed.width) : undefined, height: placed.height ? pt(placed.height) : undefined }
  const url = urls.get(figure)
  // A drawing's picture reaches past its box where its line, its arrows or its text do, the box alone taking room.
  const { bleed } = placed
  const across = (bleed?.left ?? 0) + (bleed?.right ?? 0)
  const down = (bleed?.top ?? 0) + (bleed?.bottom ?? 0)
  const picture: CSSProperties = bleed
    ? {
        position: 'absolute',
        display: 'block',
        left: pt(-(bleed.left ?? 0)),
        top: pt(-(bleed.top ?? 0)),
        width: `calc(100% + ${pt(across)})`,
        height: `calc(100% + ${pt(down)})`,
        maxWidth: 'none'
      }
    : { display: 'block', width: '100%', height: '100%' }
  return (
    <>
      <Drop item={placed} />
      <span
        style={{
          ...(bleed ? { position: 'relative' } : {}),
          ...placement(placed),
          ...size,
          textIndent: 0,
          lineHeight: 'normal',
          whiteSpace: 'normal'
        }}
      >
        {figure.kind === 'picture' ? (
          url ? (
            <img src={url} alt={placed.alt} style={picture} />
          ) : null
        ) : (
          <span className="block size-full overflow-hidden bg-white">
            <Figure figure={figure.kind === 'sheet' ? fitted(figure, placed) : figure} url={url} alt={placed.alt} block />
          </span>
        )}
      </span>
    </>
  )
}

function Box({ box }: { box: TextBox }) {
  return (
    <>
      <Drop item={box} />
      <span
        style={{
          ...placement(box),
          width: box.width ? pt(box.width) : undefined,
          minHeight: box.height ? pt(box.height) : undefined,
          boxSizing: 'border-box',
          padding: `${pt(box.insets.top)} ${pt(box.insets.right)} ${pt(box.insets.bottom)} ${pt(box.insets.left)}`,
          backgroundColor: box.fill,
          border: borderCss(box.line),
          borderRadius: box.radius ? pt(box.radius) : undefined,
          textIndent: 0,
          textAlign: 'left',
          whiteSpace: 'normal',
          verticalAlign: 'top'
        }}
      >
        <Blocks blocks={box.blocks} />
      </span>
    </>
  )
}

function Table({ table, above }: { table: DocumentTable; above: number }) {
  const width = table.columns.reduce((sum, column) => sum + column, 0)
  return (
    <table
      style={{
        borderCollapse: 'collapse',
        tableLayout: width > 0 ? 'fixed' : 'auto',
        width: width > 0 ? pt(width) : undefined,
        marginTop: above ? pt(above) : undefined,
        marginLeft: table.align === 'center' || table.align === 'right' ? 'auto' : table.indent ? pt(table.indent) : undefined,
        marginRight: table.align === 'center' ? 'auto' : undefined
      }}
    >
      {width > 0 && (
        <colgroup>
          {table.columns.map((column, index) => (
            <col key={index} style={{ width: pt(column) }} />
          ))}
        </colgroup>
      )}
      <tbody>
        {table.rows.map((row, index) => (
          <tr key={index} style={{ height: row.height ? pt(row.height.value) : undefined }}>
            {row.cells.map((cell, at) => (
              <td
                key={at}
                colSpan={cell.columns > 1 ? cell.columns : undefined}
                rowSpan={cell.rows > 1 ? cell.rows : undefined}
                style={{
                  padding: `${pt(cell.insets.top ?? 0)} ${pt(cell.insets.right ?? 5.4)} ${pt(cell.insets.bottom ?? 0)} ${pt(cell.insets.left ?? 5.4)}`,
                  backgroundColor: cell.shading,
                  verticalAlign: cell.vertical ?? 'top',
                  ...bordersStyle(cell.borders)
                }}
              >
                {/* A row of an exact height cuts what does not fit in it, as Word does, where a table's row would grow. */}
                {row.height?.exact && cell.rows === 1 ? (
                  <div style={{ height: pt(Math.max(0, row.height.value - (cell.insets.top ?? 0) - (cell.insets.bottom ?? 0))), overflow: 'hidden' }}>
                    <Blocks blocks={cell.blocks} />
                  </div>
                ) : (
                  <Blocks blocks={cell.blocks} />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The figures and boxes placed from the page's corner, drawn behind its text wherever their paragraph is. */
function anchored(blocks: readonly DocumentBlock[], found: (PlacedFigure | TextBox)[] = []): (PlacedFigure | TextBox)[] {
  for (const block of blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows) for (const cell of row.cells) anchored(cell.blocks, found)
      continue
    }
    for (const span of block.spans) {
      if ('placed' in span && span.placed.at?.from === 'page') found.push(span.placed)
      if ('box' in span && span.box.at?.from === 'page') found.push(span.box)
    }
  }
  return found
}

function Notes({ notes }: { notes: DocumentPage['notes'] }) {
  if (notes.length === 0) return null
  return (
    <div style={{ marginTop: '12pt' }}>
      <div style={{ width: '144pt', borderTop: '0.5pt solid #000000', marginBottom: '4pt' }} />
      {notes.map((note) => (
        <Blocks key={note.mark} blocks={note.blocks} />
      ))}
    </div>
  )
}

function Page({ page, look, scale, last }: { page: DocumentPage; look: DocumentLook; scale: number; last: boolean }) {
  const { margins } = page
  const sides: CSSProperties = { paddingLeft: pt(margins.left), paddingRight: pt(margins.right) }
  const placedOnPage = anchored([...page.header, ...page.footer, ...page.bands.flatMap((band) => band.blocks)])
  return (
    <div style={{ zoom: scale }} className="shrink-0 overflow-hidden rounded-xs">
      <section
        aria-label={`Page ${page.number}`}
        style={
          {
            '--paper': look.paper ?? '#ffffff',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            width: pt(page.width),
            minHeight: pt(page.height),
            backgroundColor: 'var(--paper)',
            color: '#000000',
            fontFamily: look.text.font ? fontStack(look.text.font) : undefined,
            fontSize: pt(look.text.size ?? 10),
            textAlign: 'left',
            isolation: 'isolate'
          } as CSSProperties
        }
      >
        {placedOnPage.map((item, index) =>
          'figure' in item ? (
            <div key={index} style={{ position: 'absolute', zIndex: -1, inset: 0 }}>
              <Placed placed={item} />
            </div>
          ) : (
            <div key={index} style={{ position: 'absolute', zIndex: -1, inset: 0 }}>
              <Box box={item} />
            </div>
          )
        )}
        {/* A page of no header has its text from its top margin down, wherever a header would start. */}
        <header
          style={{
            ...sides,
            boxSizing: 'border-box',
            minHeight: pt(margins.top),
            paddingTop: page.header.length > 0 ? pt(margins.header) : undefined,
            paddingBottom: page.header.length > 0 ? '6pt' : undefined
          }}
        >
          <Blocks blocks={page.header} />
        </header>
        <div style={{ ...sides, flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Text that does not fill its page sits at its top, in its middle or at its foot, as its section says. */}
          <div style={{ marginTop: page.vertical ? 'auto' : undefined, marginBottom: page.vertical === 'middle' ? 'auto' : undefined }}>
            {page.bands.map((band, index) => (
              <div key={index} style={band.columns > 1 ? { columnCount: band.columns, columnGap: pt(band.gap) } : { display: 'flow-root' }}>
                <Blocks blocks={band.blocks} />
              </div>
            ))}
            {last && <Notes notes={look.endNotes} />}
          </div>
          {/* Footnotes sit at the foot of the page's text. */}
          <div style={{ marginTop: page.vertical ? undefined : 'auto' }}>
            <Notes notes={page.notes} />
          </div>
        </div>
        <footer
          style={{
            ...sides,
            boxSizing: 'border-box',
            minHeight: pt(margins.bottom),
            paddingBottom: page.footer.length > 0 ? pt(margins.footer) : undefined,
            paddingTop: page.footer.length > 0 ? '6pt' : undefined,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end'
          }}
        >
          <Blocks blocks={page.footer} />
        </footer>
      </section>
    </div>
  )
}

/** A document's pages one under the other, each scaled down to fit the pane's width, never up. */
export function DocumentPages({
  look,
  figures,
  urls
}: {
  look: DocumentLook
  figures: readonly OfficeFigure[]
  urls: ReadonlyMap<OfficeFigure, string>
}): ReactNode {
  const holder = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const element = holder.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={holder} className="grid justify-items-center gap-4">
      {look.pages.map((page, index) => (
        <ShownContext.Provider key={index} value={{ figures, urls, page: page.number, pages: look.pages.length, tab: look.tab }}>
          <Page page={page} look={look} scale={width ? Math.min(1, width / ((page.width * 4) / 3)) : 1} last={index === look.pages.length - 1} />
        </ShownContext.Provider>
      ))}
    </div>
  )
}
