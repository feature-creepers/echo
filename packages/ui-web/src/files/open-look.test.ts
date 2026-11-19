import { describe, expect, it } from 'vitest'
import type { Archive } from './archive.ts'
import { type DocumentBlock, type DocumentLook, type DocumentParagraph, type DocumentTable, keptRooms } from './document-look.ts'
import type { PictureFigure } from './office-text.ts'
import { readOpenLook } from './open-look.ts'
import type { XmlNode } from './xml.ts'

const NAMESPACES = 'xmlns:office="o" xmlns:style="s" xmlns:text="t" xmlns:table="ta" xmlns:draw="d" xmlns:fo="f" xmlns:svg="v" xmlns:xlink="x" xmlns:loext="l"'

const STYLES = `<office:document-styles ${NAMESPACES}>
<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'"/><style:font-face style:name="Courier" svg:font-family="Courier New"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties style:tab-stop-distance="1.25cm"/><style:text-properties style:font-name="Liberation Serif" fo:font-size="12pt"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph"/>
<style:style style:name="Text_20_body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.247cm" fo:line-height="115%"/></style:style>
<style:style style:name="Heading_20_1" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="150%" fo:font-weight="bold" fo:color="#1f3864"/></style:style>
<style:style style:name="List" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="6pt" style:contextual-spacing="true"/></style:style>
<text:list-style style:name="Numbers">
<text:list-level-style-number text:level="1" style:num-prefix="(" style:num-suffix=")" style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-18pt" fo:margin-left="36pt"/></style:list-level-properties></text:list-level-style-number>
<text:list-level-style-number text:level="2" style:num-suffix="." style:num-format="a" text:display-levels="2"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="space" fo:text-indent="-18pt" fo:margin-left="54pt"/></style:list-level-properties></text:list-level-style-number>
</text:list-style>
<text:list-style style:name="Bullets"><text:list-level-style-bullet text:level="1" text:bullet-char="&#xF0B7;"><style:list-level-properties text:space-before="0.5in" text:min-label-width="0.25in"/><style:text-properties style:font-name="Symbol"/></text:list-level-style-bullet></text:list-style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm" style:num-format="i" fo:background-color="#fffff0"/>
<style:header-style><style:header-footer-properties fo:min-height="0.5cm" fo:margin-bottom="0.25cm"/></style:header-style><style:footer-style/></style:page-layout>
<style:page-layout style:name="pm2"><style:page-layout-properties fo:page-width="29.7cm" fo:page-height="21cm" fo:margin="1cm"/></style:page-layout>
<style:style style:name="MP1" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/></style:style>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="pm1"><style:header><text:p text:style-name="MP1">Page <text:page-number>1</text:page-number> of <text:page-count>1</text:page-count></text:p></style:header></style:master-page>
<style:master-page style:name="Landscape" style:page-layout-name="pm2"/>
</office:master-styles>
</office:document-styles>`

async function lookOf(
  automatic: string,
  body: string,
  figureOf: (frame: XmlNode) => Promise<number | undefined> = async () => undefined,
  drawingOf: (drawing: PictureFigure) => number | undefined = () => undefined
): Promise<DocumentLook> {
  const content = `<office:document-content ${NAMESPACES}><office:automatic-styles>${automatic}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`
  const archive: Archive = new Map([['styles.xml', async () => new TextEncoder().encode(STYLES)]])
  const read = await readOpenLook(archive, content, figureOf, drawingOf)
  if (!read) throw new Error('No look was read.')
  return read.look
}

const blocksOf = (look: DocumentLook): DocumentBlock[] => look.pages.flatMap((page) => page.bands.flatMap((band) => band.blocks))
const paragraphsOf = (look: DocumentLook) => blocksOf(look).filter((block): block is DocumentParagraph => block.kind === 'paragraph')
const textOf = (paragraph: DocumentParagraph | undefined) => paragraph?.spans.map((span) => ('text' in span ? span.text : '')).join('') ?? ''

describe('an OpenDocument text as it looks', () => {
  it('sets each paragraph and span in its style over those it comes from and its family’s default', async () => {
    const look = await lookOf(
      `<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Text_20_body"><style:paragraph-properties fo:text-align="justify" fo:margin-left="1cm" fo:text-indent="-0.5cm" fo:background-color="#eeeeee" fo:border-bottom="0.5pt solid #ff0000"><style:tab-stops><style:tab-stop style:position="5cm" style:type="right" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic" style:text-underline-style="solid" fo:background-color="#ffff00" style:text-position="super 58%"/></style:style>
<style:style style:name="T2" style:family="text"><style:text-properties style:font-name="Courier" fo:font-size="80%" style:text-line-through-style="solid" fo:font-variant="small-caps" fo:letter-spacing="0.5pt"/></style:style>`,
      `<text:h text:style-name="Heading_20_1" text:outline-level="1">Results</text:h>
<text:p text:style-name="P1">  Sales   grew<text:s text:c="2"/><text:span text:style-name="T1">up</text:span><text:span text:style-name="T2">and</text:span><text:tab/>2<text:line-break/>end </text:p>`
    )
    const [heading, body] = paragraphsOf(look)
    expect(heading).toMatchObject({ heading: 1, spans: [{ text: 'Results', look: { font: 'Liberation Serif', size: 18, bold: true, color: '#1f3864' } }] })
    expect(body?.look).toMatchObject({
      align: 'justify',
      after: expect.closeTo(7, 0),
      line: { rule: 'multiple', value: 1.15 },
      shading: '#eeeeee',
      borders: { bottom: { width: 0.5, style: 'solid', color: '#ff0000' } }
    })
    expect(body?.look.start).toBeCloseTo(28.35, 1)
    expect(body?.look.firstLine).toBeCloseTo(-14.17, 1)
    // A tab stop is measured from the paragraph's indent.
    expect(body?.look.tabs?.[0]?.position).toBeCloseTo(170.08, 1)
    expect(body?.look.tabs?.[0]).toMatchObject({ align: 'right', leader: 'dot' })
    expect(body?.spans).toMatchObject([
      { text: 'Sales grew' },
      { text: '  ' },
      { text: 'up', look: { italic: true, underline: 'solid', highlight: '#ffff00', position: 'super' } },
      { text: 'and', look: { font: 'Courier New', size: 9.6, struck: true, caps: 'small', spacing: 0.5 } },
      { tab: true },
      { text: '2' },
      { break: true },
      { text: 'end' }
    ])
    expect(look.text).toMatchObject({ font: 'Liberation Serif', size: 12 })
    expect(look.tab).toBeCloseTo(35.43, 1)
  })

  it('numbers and bullets lists as their list styles say, at each level, going on where a list says so', async () => {
    const item = (text: string, inner = '') => `<text:list-item><text:p text:style-name="List">${text}</text:p>${inner}</text:list-item>`
    const look = await lookOf(
      '',
      `<text:list text:style-name="Numbers">${item('One', `<text:list>${item('Nested')}${item('Again')}</text:list>`)}${item('Two')}</text:list>
<text:p text:style-name="Standard">Between</text:p>
<text:list text:style-name="Numbers" text:continue-numbering="true">${item('Three')}</text:list>
<text:list text:style-name="Numbers">${item('One again')}</text:list>
<text:list text:style-name="Bullets">${item('Bullet')}</text:list>`
    )
    const marks = paragraphsOf(look).map((one) => [textOf(one), one.marker?.text])
    expect(marks).toEqual([
      ['One', '(1)'],
      ['Nested', '1.a. '],
      ['Again', '1.b. '],
      ['Two', '(2)'],
      ['Between', undefined],
      ['Three', '(3)'],
      ['One again', '(1)'],
      ['Bullet', '•']
    ])
    const [one, nested] = paragraphsOf(look)
    expect(one?.look).toMatchObject({ start: 36, firstLine: -18, after: 0 })
    expect(nested?.marker).toMatchObject({ tab: false })
    expect(paragraphsOf(look)[7]?.look).toMatchObject({ start: 54, firstLine: -18 })
  })

  it('lays tables out with their columns, merged cells, borders, padding and backgrounds, their heading rows again after a page breaks', async () => {
    const look = await lookOf(
      `<style:style style:name="Tab" style:family="table"><style:table-properties style:width="10cm" table:align="center"/></style:style>
<style:style style:name="ColA" style:family="table-column"><style:table-column-properties style:column-width="2cm"/></style:style>
<style:style style:name="ColB" style:family="table-column"><style:table-column-properties style:column-width="3cm"/></style:style>
<style:style style:name="Row" style:family="table-row"><style:table-row-properties style:min-row-height="1cm"/></style:style>
<style:style style:name="Head" style:family="table-cell"><style:table-cell-properties fo:background-color="#4472c4" fo:border="0.5pt solid #000000" fo:padding="0.1cm" style:vertical-align="middle"/></style:style>`,
      `<table:table table:style-name="Tab"><table:table-column table:style-name="ColA"/><table:table-column table:style-name="ColB" table:number-columns-repeated="2"/>
<table:table-header-rows><table:table-row><table:table-cell table:style-name="Head" table:number-columns-spanned="2"><text:p>City</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>Sales</text:p></table:table-cell></table:table-row></table:table-header-rows>
<table:table-row table:style-name="Row"><table:table-cell table:number-rows-spanned="2"><text:p>Lyon</text:p></table:table-cell><table:table-cell><text:p>1</text:p></table:table-cell><table:table-cell><text:p>2</text:p></table:table-cell></table:table-row>
<text:soft-page-break/>
<table:table-row><table:covered-table-cell/><table:table-cell><text:p>3</text:p></table:table-cell><table:table-cell><text:p>4</text:p></table:table-cell></table:table-row>
</table:table>`
    )
    expect(look.pages).toHaveLength(2)
    const [first, second] = look.pages.map((page) => page.bands[0]?.blocks[0] as DocumentTable)
    // The columns, 2 + 3 + 3 cm, are scaled to the table's 10 cm.
    expect(first?.columns.map((one) => Math.round(one))).toEqual([71, 106, 106])
    expect(first?.align).toBe('center')
    expect(first?.rows[0]?.cells[0]).toMatchObject({ columns: 2, shading: '#4472c4', vertical: 'middle', borders: { top: { width: 0.5, color: '#000000' } } })
    expect(first?.rows[0]?.cells[0]?.insets.left).toBeCloseTo(2.83, 1)
    // A cell spanning rows across the break stops at it.
    expect(first?.rows[1]?.cells[0]?.rows).toBe(1)
    expect(first?.rows[1]?.height?.value).toBeCloseTo(28.35, 1)
    expect(second?.rows.map((row) => row.cells.length)).toEqual([2, 2])
  })

  it('lays its pages out by their master pages, with headers, page numbers and breaks, and their notes at their foot', async () => {
    const look = await lookOf(
      `<style:style style:name="Break" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="Wide" style:family="paragraph" style:parent-style-name="Standard" style:master-page-name="Landscape"/>`,
      `<text:p text:style-name="Standard">One<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>A note.</text:p></text:note-body></text:note></text:p>
<text:p text:style-name="Standard">Two halves: before<text:soft-page-break/>after</text:p>
<text:p text:style-name="Break"/>
<text:soft-page-break/>
<text:p text:style-name="Standard">Three</text:p>
<text:p text:style-name="Wide">Wide<text:note text:note-class="endnote"><text:note-citation>i</text:note-citation><text:note-body><text:p>An end note.</text:p></text:note-body></text:note></text:p>`
    )
    const pages = look.pages.map((page) => page.bands.flatMap((band) => band.blocks).map((block) => textOf(block as DocumentParagraph)))
    expect(pages).toEqual([['One', 'Two halves: before'], ['after'], ['', 'Three'], ['Wide']])
    const [first, , , wide] = look.pages
    expect(first).toMatchObject({ number: 'i', margins: { header: expect.closeTo(56.69, 1) } })
    expect(first?.width).toBeCloseTo(595.28, 1)
    expect(first?.margins.top).toBeCloseTo(56.69 + 14.17 + 7.09, 1)
    const header = first?.header[0] as DocumentParagraph | undefined
    expect(header?.spans.map((span) => ('field' in span ? span.field : 'text' in span ? span.text : ''))).toEqual(['Page ', 'page', ' of ', 'pages'])
    expect(first?.notes).toHaveLength(1)
    expect(textOf(first?.notes[0]?.blocks[0] as DocumentParagraph)).toBe('A note.')
    expect(wide?.width).toBeCloseTo(841.89, 1)
    expect(wide?.header).toEqual([])
    expect(look.endNotes).toHaveLength(1)
    expect(look.paper).toBe('#fffff0')
  })

  it('places frames’ pictures in their line, on the page or floating, and shows boxes of text and shapes with their fill', async () => {
    const figureOf = async (frame: XmlNode) => (childAt(frame) ? 0 : undefined)
    const drawings: PictureFigure[] = []
    const look = await lookOf(
      `<style:style style:name="fr1" style:family="graphic"><style:graphic-properties style:wrap="parallel" style:horizontal-pos="right" style:horizontal-rel="paragraph"/></style:style>
<style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#729fcf" svg:stroke-color="#3465a4"/></style:style>`,
      `<draw:frame text:anchor-type="page" text:anchor-page-number="1" svg:x="2cm" svg:y="3cm" svg:width="4cm" svg:height="2cm"><draw:image xlink:href="Pictures/a.png"/></draw:frame>
<text:p>Text <draw:frame text:anchor-type="as-char" svg:width="1in" svg:height="0.5in"><draw:image xlink:href="Pictures/a.png"/><svg:title>A square</svg:title></draw:frame><draw:frame draw:style-name="fr1" text:anchor-type="paragraph" svg:width="2in" svg:height="1in"><draw:image xlink:href="Pictures/a.png"/></draw:frame><draw:frame text:anchor-type="as-char" svg:width="2in"><draw:text-box fo:min-height="1in"><text:p>In a box</text:p></draw:text-box></draw:frame><draw:custom-shape draw:style-name="gr1" text:anchor-type="as-char" svg:width="1in" svg:height="1in"><svg:title>Not text</svg:title><text:p>Shape</text:p><draw:enhanced-geometry draw:type="rectangle"/></draw:custom-shape></text:p>`,
      figureOf,
      (drawing) => drawings.push(drawing) + 99
    )
    const [anchored, body] = paragraphsOf(look)
    expect(anchored?.spans[0]).toMatchObject({ placed: { figure: 0, at: { from: 'page' } } })
    expect(body?.spans).toMatchObject([
      { text: 'Text ' },
      { placed: { figure: 0, alt: 'A square', width: 72, height: 36 } },
      { placed: { figure: 0, float: 'right' } },
      { box: { width: 144, height: 72 } },
      { placed: { figure: 100, alt: 'Not text', width: 72, height: 72 } }
    ])
    // A shape is drawn as a picture of its own, its fill, line and text in it; its title is its picture's words, not text.
    const svg = new TextDecoder().decode(drawings[0]?.bytes)
    expect(drawings[0]).toMatchObject({ kind: 'picture', type: 'image/svg+xml' })
    for (const piece of ['fill="#729fcf"', 'stroke="#3465a4"', '>Shape<']) expect(svg).toContain(piece)
    expect(body?.spans.map((span) => ('text' in span ? span.text : '')).join('')).not.toContain('Not text')
  })

  it.each([
    {
      name: 'a line in its line of text, as a character',
      element: '<draw:line draw:style-name="gr2" text:anchor-type="as-char" svg:x1="0in" svg:y1="0in" svg:x2="1in" svg:y2="0.5in"/>',
      placed: { width: 72, height: 36, at: undefined, room: undefined },
      shows: ['<path d="M0 0L96 48"']
    },
    {
      name: 'an ellipse over the text, from its paragraph, where the text runs through it',
      element: '<draw:ellipse draw:style-name="gr3" text:anchor-type="paragraph" svg:x="1in" svg:y="0.5in" svg:width="1in" svg:height="1in"/>',
      placed: { width: 72, height: 72, at: { x: expect.closeTo(72, 1), y: expect.closeTo(36, 1), from: 'paragraph' }, room: undefined },
      shows: ['fill="#ff0000"']
    },
    {
      name: 'a group with no text beside it, keeping its room in its paragraph',
      element:
        '<draw:g draw:style-name="gr4" text:anchor-type="paragraph"><draw:rect draw:style-name="gr3" svg:x="0.5in" svg:y="0.25in" svg:width="1in" svg:height="0.5in"/><draw:polygon draw:style-name="gr3" svg:x="2in" svg:y="0.25in" svg:width="1in" svg:height="1in" svg:viewBox="0 0 10 10" draw:points="0,0 10,0 5,10"/></draw:g>',
      placed: { width: 180, height: 72, at: { x: expect.closeTo(36, 1), y: expect.closeTo(18, 1), from: 'paragraph' }, room: true },
      shows: ['translate(48 24)', 'M0 0L96 0L48 96']
    },
    {
      name: 'a custom shape on its page, centred on it',
      element:
        '<draw:custom-shape draw:style-name="gr5" text:anchor-type="page" text:anchor-page-number="1" svg:width="2in" svg:height="1in"><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="diamond" draw:enhanced-path="M 10800 0 L 21600 10800 10800 21600 0 10800 Z N"/></draw:custom-shape>',
      placed: { width: 144, height: 72, at: { x: expect.closeTo(225.64, 1), y: expect.closeTo(384.95, 1), from: 'page' }, room: undefined },
      shows: ['M96 0L192 48L96 96L0 48Z']
    }
  ])('draws $name as a picture placed as it says', async ({ element, placed, shows }) => {
    const drawings: PictureFigure[] = []
    const look = await lookOf(
      `<style:style style:name="gr2" style:family="graphic"><style:graphic-properties svg:stroke-color="#000000" svg:stroke-width="0in"/></style:style>
<style:style style:name="gr3" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#ff0000" draw:stroke="none" style:wrap="run-through"/></style:style>
<style:style style:name="gr4" style:family="graphic"><style:graphic-properties style:wrap="none"/></style:style>
<style:style style:name="gr5" style:family="graphic"><style:graphic-properties style:horizontal-pos="center" style:horizontal-rel="page" style:vertical-pos="middle" style:vertical-rel="page"/></style:style>`,
      `<text:p>Before ${element}after</text:p>`,
      undefined,
      (drawing) => drawings.push(drawing) - 1
    )
    const spans = paragraphsOf(look).flatMap((paragraph) => paragraph.spans)
    const found = spans.find((one) => 'placed' in one)
    const shown = found && 'placed' in found ? found.placed : undefined
    expect(shown && { figure: shown.figure, width: shown.width, height: shown.height, at: shown.at, room: shown.room }).toEqual({ figure: 0, ...placed })
    const svg = new TextDecoder().decode(drawings[0]?.bytes)
    for (const piece of shows) expect(svg).toContain(piece)
    expect(svg).not.toMatch(/<script|href="(?!data:)/)
  })

  it.each([
    { name: 'none for a figure the text runs beside', spans: [{ placed: { figure: 0, alt: '', at: { x: 0, y: 10, from: 'paragraph' as const } } }], rooms: [] },
    {
      name: 'a band from a figure’s top to its bottom, its reach included',
      spans: [
        {
          placed: {
            figure: 0,
            alt: '',
            height: 20,
            room: true,
            at: { x: 0, y: 10, from: 'paragraph' as const },
            bleed: { top: 2, right: 0, bottom: 3, left: 0 }
          }
        }
      ],
      rooms: [{ top: 8, height: 25 }]
    },
    {
      name: 'one band for figures that meet, another for one further down',
      spans: [
        { placed: { figure: 0, alt: '', height: 20, room: true, at: { x: 0, y: 0, from: 'paragraph' as const } } },
        { box: { height: 10, room: true, at: { x: 0, y: 15, from: 'paragraph' as const }, insets: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [] } },
        { placed: { figure: 1, alt: '', height: 5, room: true, at: { x: 0, y: 50, from: 'paragraph' as const } } }
      ],
      rooms: [
        { top: 0, height: 25 },
        { top: 50, height: 5 }
      ]
    },
    {
      name: 'none for a figure placed on its page',
      spans: [{ placed: { figure: 0, alt: '', height: 20, room: true, at: { x: 0, y: 10, from: 'page' as const } } }],
      rooms: []
    }
  ])('keeps $name', ({ spans, rooms }) => {
    expect(keptRooms(spans)).toEqual(rooms)
  })

  const PLACING = `<style:default-style style:family="graphic"><style:graphic-properties draw:fill-color="#729fcf"/></style:default-style>
<style:style style:name="Frame" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none" style:wrap="parallel"/></style:style>
<style:style style:name="framed" style:family="graphic" style:parent-style-name="Frame"/>
<style:style style:name="filled" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#00ff00"/></style:style>
<style:style style:name="backed" style:family="graphic"><style:graphic-properties fo:background-color="#0000ff" draw:stroke="solid" svg:stroke-color="#ff0000"/></style:style>
<style:style style:name="margin" style:family="graphic"><style:graphic-properties loext:vertical-rel="page-content-bottom"/></style:style>
<style:style style:name="wrapped" style:family="graphic"><style:graphic-properties style:wrap="parallel" style:horizontal-pos="from-left"/></style:style>`
  const placedIn = (look: DocumentLook) => paragraphsOf(look).flatMap((paragraph) => paragraph.spans)

  it.each([
    {
      name: 'a frame of text with no fill of its own, not the shapes’ fill of the default style',
      body: '<draw:frame text:anchor-type="as-char" svg:width="1in"><draw:text-box><text:p>Box</text:p></draw:text-box></draw:frame>',
      check: (look: DocumentLook) => expect(placedIn(look)[0]).toMatchObject({ box: { fill: undefined, line: undefined } })
    },
    {
      name: 'a frame of text filled as its style says, and lined and rounded as a shape is',
      body: '<draw:frame draw:style-name="filled" text:anchor-type="as-char" svg:width="1in"><draw:text-box draw:corner-radius="0.25in"><text:p>Box</text:p></draw:text-box></draw:frame><draw:frame draw:style-name="backed" text:anchor-type="as-char" svg:width="1in"><draw:text-box><text:p>Box</text:p></draw:text-box></draw:frame>',
      check: (look: DocumentLook) =>
        expect(placedIn(look)).toMatchObject([
          { box: { fill: '#00ff00', radius: 18 } },
          { box: { fill: '#0000ff', line: { color: '#ff0000', style: 'solid' } } }
        ])
    },
    {
      name: 'a drawing from the page’s bottom margin, as LibreOffice’s own relation says',
      body: '<draw:rect draw:style-name="margin" text:anchor-type="paragraph" svg:x="0cm" svg:y="-1cm" svg:width="1cm" svg:height="1cm"/>',
      check: (look: DocumentLook) =>
        expect(placedIn(look)[0]).toMatchObject({ placed: { at: { x: expect.closeTo(70.87, 1), y: expect.closeTo(756.85, 1), from: 'page' } } })
    },
    {
      name: 'a frame the text wraps beside, floating down from its paragraph',
      body: '<draw:frame draw:style-name="wrapped" text:anchor-type="paragraph" svg:y="1in" svg:width="1in" svg:height="1in"><draw:image xlink:href="Pictures/a.png"/></draw:frame>Beside',
      check: (look: DocumentLook) => expect(placedIn(look)[0]).toMatchObject({ placed: { float: 'left', drop: 72 } })
    },
    {
      name: 'a drawing whose style names no wrap, the text running through it',
      body: '<draw:rect text:anchor-type="paragraph" svg:x="0in" svg:y="0in" svg:width="1in" svg:height="1in"/>',
      check: (look: DocumentLook) => {
        const [first] = placedIn(look)
        expect(first && 'placed' in first ? first.placed.room : 'none').toBeUndefined()
      }
    },
    {
      name: 'a drawing in a frame, anchored to it, placed from its box',
      body: '<draw:frame text:anchor-type="as-char" svg:width="3in" svg:height="2in"><draw:text-box><draw:rect text:anchor-type="frame" svg:x="0.5in" svg:y="0.25in" svg:width="1in" svg:height="1in"/><text:p>Boxed</text:p></draw:text-box></draw:frame>',
      check: (look: DocumentLook) => {
        const [frame] = placedIn(look)
        const inner = frame && 'box' in frame ? frame.box.blocks[0] : undefined
        expect(inner?.kind === 'paragraph' ? inner.spans[0] : undefined).toMatchObject({
          placed: { at: { x: expect.closeTo(36, 1), y: expect.closeTo(18, 1), from: 'paragraph' } }
        })
      }
    }
  ])('places $name', async ({ body, check }) => {
    check(
      await lookOf(
        PLACING,
        `<text:p>${body}</text:p>`,
        async (frame) => (childAt(frame) ? 0 : undefined),
        () => 0
      )
    )
  })

  it('draws a drawing in its own style alone, not the frame style it names, as Writer does', async () => {
    const drawings: PictureFigure[] = []
    await lookOf(
      PLACING,
      '<text:p><draw:rect draw:style-name="framed" text:anchor-type="as-char" svg:width="1in" svg:height="1in"/></text:p>',
      undefined,
      (drawing) => drawings.push(drawing) - 1
    )
    expect(new TextDecoder().decode(drawings[0]?.bytes)).toContain('fill="#729fcf"')
  })
})

/** Whether a frame shows a picture: the stub that stands for the figures the text found. */
function childAt(frame: XmlNode): boolean {
  return frame.children.some((child) => child.name === 'draw:image')
}
