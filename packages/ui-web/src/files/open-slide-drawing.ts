/**
 * A slide of an OpenDocument presentation drawn as it looks, in SVG (docs/SPEC.md, section 9.7). A page (`draw:page`)
 * names its master page, whose layout gives the slides' size and whose shapes are drawn under its own, but for its
 * placeholders, which are its pages' to fill, and its footers, which a page shows when it says so. Its background is
 * its own or its master's. Each shape is drawn as `open-drawing.ts` draws any OpenDocument's.
 */

import { type Archive, textOf } from './archive.ts'
import { type DrawingContext, type DrawingSource, drawingSource, drawShapes, fillOf, plainText } from './open-drawing.ts'
import { fontFaces, length, type Properties, StyleBook } from './open-styles.ts'
import { Canvas, type DrawnSlide, type Fill, fillAttribute, number, slideSvg } from './slide-svg.ts'
import { childAt, childrenNamed, type XmlNode, xmlTree } from './xml.ts'

// The deck

/** What a presentation's pages are drawn with, read once for them all: what its shapes are drawn from, its footers, dates, master pages and layouts. */
export interface OpenDeck extends DrawingSource {
  footers: Map<string, string>
  dates: Map<string, string>
  masters: Map<string, XmlNode>
  layouts: Map<string, XmlNode>
}

const ROOT_CONTENT = 'office:document-content'
const ROOT_STYLES = 'office:document-styles'

/** A presentation's styles, fonts, master pages and the declarations of its footers, from its content and `styles.xml`. */
export async function openDeck(archive: Archive, content: XmlNode): Promise<OpenDeck> {
  const stylesXml = await textOf(archive, 'styles.xml')
  const styles = stylesXml === undefined ? undefined : xmlTree(stylesXml)
  const document = childAt(content, ROOT_CONTENT)
  const stylesRoot = childAt(styles, ROOT_STYLES)
  const book = new StyleBook(childAt(document, 'office:automatic-styles'), childAt(stylesRoot, 'office:automatic-styles'), childAt(stylesRoot, 'office:styles'))
  const source = await drawingSource(archive, book, fontFaces([stylesRoot, document]), stylesRoot)
  const masters = new Map<string, XmlNode>()
  for (const master of childrenNamed(childAt(stylesRoot, 'office:master-styles'), 'style:master-page'))
    masters.set(master.attributes['style:name'] ?? '', master)
  const layouts = new Map<string, XmlNode>()
  for (const layout of childrenNamed(childAt(stylesRoot, 'office:automatic-styles'), 'style:page-layout'))
    layouts.set(layout.attributes['style:name'] ?? '', layout)
  const footers = new Map<string, string>()
  const dates = new Map<string, string>()
  const presentation = childAt(document, 'office:body', 'office:presentation')
  for (const declaration of presentation?.children ?? []) {
    const name = declaration.attributes['presentation:name'] ?? ''
    if (declaration.name === 'presentation:footer-decl') footers.set(name, plainText(declaration))
    else if (declaration.name === 'presentation:date-time-decl' && declaration.attributes['presentation:source'] !== 'current-date')
      dates.set(name, plainText(declaration))
  }
  return { ...source, footers, dates, masters, layouts }
}

// Drawing

/** The classes of placeholders a master's slides fill, and those of their footers, shown as each slide says. */
const FOOTERS: Record<string, string> = {
  footer: 'presentation:display-footer',
  'page-number': 'presentation:display-page-number',
  'date-time': 'presentation:display-date-time'
}

/** A page's background: its own fill, else its master's, as its style lets it; white when none is given. */
async function backgroundOf(master: XmlNode | undefined, masterName: string, pageStyle: Properties, context: DrawingContext): Promise<Fill> {
  const { book } = context.source
  const own = await fillOf(pageStyle, context)
  if (own && own.kind !== 'none') return own
  if (pageStyle['presentation:background-visible'] !== 'false') {
    const masterStyle = book.properties('drawing-page', master?.attributes['draw:style-name'], 'drawing-page', true, false)
    const masters = await fillOf(masterStyle, context)
    if (masters && masters.kind !== 'none') return masters
    // Older files keep a master's background in a presentation style of its own.
    const older = await fillOf(book.properties('presentation', `${masterName}-background`, 'graphic', true, false), context)
    if (older && older.kind !== 'none') return older
  }
  return { kind: 'paint', paint: { red: 255, green: 255, blue: 255, opacity: 1 } }
}

/** A page of an OpenDocument presentation drawn as SVG, at the size its master's layout gives; `place` its number in the show. */
export async function drawOpenPage(deck: OpenDeck, page: XmlNode, place: number): Promise<DrawnSlide | undefined> {
  if (page.name !== 'draw:page') return undefined
  const masterName = page.attributes['draw:master-page-name'] ?? ''
  const master = deck.masters.get(masterName)
  const layout = deck.layouts.get(master?.attributes['style:page-layout-name'] ?? '')
  const layoutProperties = childAt(layout, 'style:page-layout-properties')?.attributes ?? {}
  const width = length(layoutProperties['fo:page-width']) ?? 1058
  const height = length(layoutProperties['fo:page-height']) ?? 794
  if (!(width > 0 && height > 0 && width < 100_000 && height < 100_000)) return undefined
  const pageStyle = deck.book.properties('drawing-page', page.attributes['draw:style-name'], 'drawing-page', false, false)
  const context: DrawingContext = {
    source: deck,
    place,
    footer: deck.footers.get(page.attributes['presentation:use-footer-name'] ?? ''),
    date: deck.dates.get(page.attributes['presentation:use-date-time-name'] ?? ''),
    canvas: new Canvas(),
    shapes: 0,
    pictureBytes: 0,
    // A master's placeholders are its slides' to fill, but for its footers, which a slide shows when it says so.
    shown: (node, inMaster) => {
      const kind = node.attributes['presentation:class']
      if (kind === undefined) return true
      if (inMaster) return FOOTERS[kind] !== undefined && pageStyle[FOOTERS[kind]] === 'true'
      return node.attributes['presentation:placeholder'] !== 'true'
    }
  }
  const size = { width, height }
  const ground = await backgroundOf(master, masterName, pageStyle, context)
  context.canvas.parts.push(`<rect width="${number(width)}" height="${number(height)}" ${fillAttribute(ground, context.canvas, size)}/>`)
  if (master && pageStyle['presentation:background-objects-visible'] !== 'false') await drawShapes(master, context, true, 0)
  await drawShapes(page, context, false, 0)
  return slideSvg(width, height, context.canvas)
}
