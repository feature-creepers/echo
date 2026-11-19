import { describe, expect, it } from 'vitest'
import type { Archive } from './archive.ts'
import type { DocumentBlock, DocumentLook, DocumentParagraph, DocumentTable } from './document-look.ts'
import { Figures } from './office-figures.ts'
import { listMark, readWordLook } from './word-look.ts'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** An archive of the parts given, as text. */
const archiveOf = (parts: Record<string, string | Uint8Array>): Archive =>
  new Map(Object.entries(parts).map(([name, content]) => [name, async () => (typeof content === 'string' ? new TextEncoder().encode(content) : content)]))

const DOCUMENT_RELATIONSHIPS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rStyles" Type="styles" Target="styles.xml"/>
<Relationship Id="rNumbering" Type="numbering" Target="numbering.xml"/>
<Relationship Id="rTheme" Type="theme" Target="theme/theme1.xml"/>
<Relationship Id="rFooter" Type="footer" Target="footer1.xml"/>
<Relationship Id="rFirst" Type="header" Target="header1.xml"/>
<Relationship Id="rNotes" Type="footnotes" Target="footnotes.xml"/>
<Relationship Id="rPicture" Type="image" Target="media/picture.png"/>
<Relationship Id="rLink" Type="hyperlink" Target="https://example.org/" TargetMode="External"/>
</Relationships>`

const THEME = `<a:theme xmlns:a="a"><a:themeElements><a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`

const STYLES = `<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="80"/></w:pPr>
<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="0F4761" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>
<w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Grid"/><w:basedOn w:val="TableNormal"/>
<w:pPr><w:spacing w:after="0"/></w:pPr>
<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr>
<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr>
<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr>
</w:style>
</w:styles>`

const NUMBERING = `<w:numbering ${W} xmlns:mc="mc">
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/><w:lvlJc w:val="right"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="2">
<w:lvl w:ilvl="0"><w:start w:val="1"/><mc:AlternateContent><mc:Choice Requires="w14"><w:numFmt w:val="custom" w:format="α, β, γ, ..."/></mc:Choice><mc:Fallback><w:numFmt w:val="decimal"/></mc:Fallback></mc:AlternateContent><w:lvlText w:val="%1."/><w:suff w:val="space"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`

const run = (text: string, properties = '') => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
const paragraph = (content: string, properties = '') => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content}</w:p>`
const listed = (text: string, list: number, level = 0) =>
  paragraph(run(text), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${list}"/></w:numPr>`)

async function lookOf(body: string, parts: Record<string, string | Uint8Array> = {}): Promise<DocumentLook> {
  const archive = archiveOf({
    'word/document.xml': `<w:document ${W} xmlns:r="r" xmlns:wp="wp" xmlns:a="a" xmlns:pic="pic"><w:body>${body}</w:body></w:document>`,
    'word/_rels/document.xml.rels': DOCUMENT_RELATIONSHIPS,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    'word/theme/theme1.xml': THEME,
    ...parts
  })
  const read = await readWordLook(archive, new Figures(archive))
  if (!read) throw new Error('No look was read.')
  return read.look
}

/** What a test expects to be there. */
function present<Value>(found: Value | undefined): Value {
  if (found === undefined) throw new Error('It is not there.')
  return found
}

const blocksOf = (look: DocumentLook): DocumentBlock[] => look.pages.flatMap((page) => page.bands.flatMap((band) => band.blocks))
const paragraphsOf = (look: DocumentLook) => blocksOf(look).filter((block): block is DocumentParagraph => block.kind === 'paragraph')
const textOf = (paragraph: DocumentParagraph | undefined) => paragraph?.spans.map((span) => ('text' in span ? span.text : '')).join('') ?? ''

describe('a Word document as it looks', () => {
  it('sets each run in the fold of its defaults, its style and those it is based on, its character style and its own', async () => {
    const look = await lookOf(
      paragraph(run('Results') + run(' in short', '<w:b w:val="0"/><w:i/><w:sz w:val="28"/>'), '<w:pStyle w:val="Heading1"/>') +
        paragraph(run('Strong', '<w:rStyle w:val="Strong"/>') + run('plain', '<w:color w:val="auto"/><w:highlight w:val="yellow"/><w:u w:val="dash"/>'))
    )
    const [heading, body] = paragraphsOf(look)
    expect(heading?.heading).toBe(1)
    expect(heading?.spans[0]).toEqual({ text: 'Results', look: { font: 'Aptos Display', size: 20, color: '#2f5496' }, link: undefined })
    expect(heading?.spans[1]).toMatchObject({ text: ' in short', look: { font: 'Aptos Display', size: 14, bold: false, italic: true } })
    expect(heading?.look).toMatchObject({ before: 18, after: 4, line: { rule: 'multiple', value: 259 / 240 } })
    expect(body?.spans[0]).toMatchObject({ text: 'Strong', look: { font: 'Aptos', size: 11, bold: true, color: '#c00000' } })
    expect(body?.spans[1]).toMatchObject({ text: 'plain', look: { color: undefined, highlight: '#ffff00', underline: 'dashed' } })
    expect(look.text).toEqual({ font: 'Aptos', size: 11 })
  })

  it.each<[string, string, Partial<DocumentParagraph['look']>]>([
    ['centred', '<w:jc w:val="center"/>', { align: 'center' }],
    ['justified', '<w:jc w:val="both"/>', { align: 'justify' }],
    ['indented with a hanging first line', '<w:ind w:left="720" w:right="360" w:hanging="360"/>', { start: 36, end: 18, firstLine: -18 }],
    ['indented from its start, as newer files write it', '<w:ind w:start="1440" w:firstLine="720"/>', { start: 72, firstLine: 36 }],
    ['spaced exactly', '<w:spacing w:line="300" w:lineRule="exact"/>', { line: { rule: 'exact', value: 15 } }],
    ['spaced at least', '<w:spacing w:line="480" w:lineRule="atLeast"/>', { line: { rule: 'least', value: 24 } }],
    ['double spaced', '<w:spacing w:line="480" w:lineRule="auto"/>', { line: { rule: 'multiple', value: 2 } }],
    ['spaced as HTML does', '<w:spacing w:beforeAutospacing="1" w:afterAutospacing="1"/>', { before: 14, after: 14 }],
    ['shaded', '<w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>', { shading: '#fff2cc' }],
    ['shaded with a pattern', '<w:shd w:val="pct25" w:color="000000" w:fill="FFFFFF"/>', { shading: '#bfbfbf' }],
    [
      'bordered',
      '<w:pBdr><w:top w:val="single" w:sz="8" w:color="FF0000"/><w:bottom w:val="double" w:sz="4" w:color="auto"/></w:pBdr>',
      {
        borders: {
          top: { width: 1, style: 'solid', color: '#ff0000' },
          bottom: { width: 2.25, style: 'double', color: '#000000' },
          left: undefined,
          right: undefined
        }
      }
    ],
    [
      'with tab stops',
      '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9350"/><w:tab w:val="center" w:pos="4680"/></w:tabs>',
      {
        tabs: [
          { position: 234, align: 'center', leader: undefined },
          { position: 467.5, align: 'right', leader: 'dot' }
        ]
      }
    ]
  ])('lays out a paragraph %s', async (_, properties, expected) => {
    const [read] = paragraphsOf(await lookOf(paragraph(run('Text'), properties)))
    expect(read?.look).toMatchObject(expected)
  })

  it('numbers lists as their levels say, counting on across lists of one kind and again where a list starts over', async () => {
    const look = await lookOf(
      [
        listed('One', 1),
        listed('Nested', 1, 1),
        listed('Two', 1),
        listed('Bullet', 2),
        listed('Three, the same kind of list', 1),
        listed('Five, started over', 3),
        listed('Alpha', 4),
        listed('Beta', 4)
      ].join('')
    )
    const markers = paragraphsOf(look).map((one) => one.marker)
    expect(markers.map((marker) => marker?.text)).toEqual(['1.', '1.a)', '2.', '•', '3.', '5.', 'α. ', 'β. '])
    expect(markers[1]).toMatchObject({ align: 'right', tab: true })
    expect(markers[3]?.look.font).toBeUndefined()
    expect(markers[6]?.tab).toBe(false)
    // A list's level gives its indent, its paragraph style none of its own spacing between items of one style.
    expect(paragraphsOf(look)[0]?.look).toMatchObject({ start: 36, firstLine: -18, after: 0 })
  })

  it.each<[string, number, string]>([
    ['decimal', 12, '12'],
    ['upperRoman', 1994, 'MCMXCIV'],
    ['lowerRoman', 4, 'iv'],
    ['upperLetter', 3, 'C'],
    ['lowerLetter', 28, 'bb'],
    ['decimalZero', 7, '07'],
    ['ordinal', 22, '22nd'],
    ['ordinal', 13, '13th'],
    ['cardinalText', 3, 'Three'],
    ['ordinalText', 2, 'Second'],
    ['russianLower', 2, 'б'],
    ['decimalEnclosedCircle', 3, '③'],
    ['decimalFullWidth', 12, '１２']
  ])('writes the %s number %i as %s', (format, count, written) => {
    expect(listMark(format, count)).toBe(written)
  })

  it.each<[string, number, string]>([
    ['001', 12, '012'],
    ['α', 3, 'γ'],
    ['α', 18, 'σ']
  ])('counts on from a custom first number %s to %i as %s', (first, count, written) => {
    expect(listMark('custom', count, first)).toBe(written)
  })

  it('draws a table with its grid, merged cells, its borders and its style’s looks of the first row and the bands', async () => {
    const cell = (text: string, properties = '') => `<w:tc>${properties ? `<w:tcPr>${properties}</w:tcPr>` : ''}${paragraph(run(text))}</w:tc>`
    const look = await lookOf(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblLook w:val="04A0"/></w:tblPr>
<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/><w:gridCol w:w="1000"/></w:tblGrid>
<w:tr>${cell('City')}${cell('Sales', '<w:gridSpan w:val="2"/>')}</w:tr>
<w:tr>${cell('Lyon', '<w:vMerge w:val="restart"/>')}${cell('120')}${cell('+12', '<w:shd w:val="clear" w:fill="CCFFCC"/><w:vAlign w:val="center"/>')}</w:tr>
<w:tr>${cell('', '<w:vMerge/>')}${cell('80')}${cell('-3', '<w:tcBorders><w:bottom w:val="nil"/></w:tcBorders>')}</w:tr>
</w:tbl>`
    )
    const table = blocksOf(look).find((block): block is DocumentTable => block.kind === 'table')
    expect(table?.columns).toEqual([100, 150, 50])
    expect(table?.align).toBe('center')
    expect(table?.rows.map((row) => row.cells.map((one) => [one.columns, one.rows]))).toEqual([
      [
        [1, 1],
        [2, 1]
      ],
      [
        [1, 2],
        [1, 1],
        [1, 1]
      ],
      [
        [1, 1],
        [1, 1]
      ]
    ])
    const [head, first] = table?.rows ?? []
    expect(head?.cells[0]).toMatchObject({ shading: '#4472c4', borders: { top: { width: 0.5, color: '#000000' }, bottom: { color: '#999999' } } })
    expect((present(head?.cells[0]?.blocks[0]) as DocumentParagraph).spans[0]).toMatchObject({ look: { bold: true, color: '#ffffff' } })
    expect((present(head?.cells[0]?.blocks[0]) as DocumentParagraph).look.after).toBe(0)
    expect(first?.cells[1]).toMatchObject({ shading: '#d9e2f3', insets: { left: 5.4, right: 5.4 } })
    expect(first?.cells[2]).toMatchObject({ shading: '#ccffcc', vertical: 'middle' })
    expect(table?.rows[2]?.cells[1]?.borders.bottom).toEqual({ width: 0, style: 'solid', color: '#000000' })
  })

  it('breaks pages where the document does and where Word last did, a paragraph going on without its number', async () => {
    const look = await lookOf(
      [
        listed('First page', 1),
        paragraph(`${run('Before')}<w:r><w:lastRenderedPageBreak/><w:t>after</w:t></w:r>`, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
        paragraph(`${run('End')}<w:r><w:br w:type="page"/></w:r>`),
        paragraph(run('Third page')),
        paragraph(run('Fourth'), '<w:pageBreakBefore/>')
      ].join('')
    )
    const pages = look.pages.map((page) => page.bands.flatMap((band) => band.blocks).map((block) => textOf(block as DocumentParagraph)))
    expect(pages).toEqual([['First page', 'Before'], ['after', 'End'], ['Third page'], ['Fourth']])
    const [, second] = look.pages
    const continued = second?.bands[0]?.blocks[0] as DocumentParagraph
    expect(continued.marker).toBeUndefined()
    expect(continued.look.firstLine).toBe(0)
  })

  it('lays out sections with their page size, margins, columns, headers, footers and numbers', async () => {
    const section = (properties: string) => `<w:sectPr xmlns:r="r">${properties}</w:sectPr>`
    const look = await lookOf(
      [
        paragraph(run('Cover')),
        paragraph(run('Body'), '<w:pageBreakBefore/>'),
        paragraph(
          '',
          section(
            '<w:footerReference w:type="default" r:id="rFooter"/><w:headerReference w:type="first" r:id="rFirst"/><w:titlePg/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/><w:pgNumType w:start="3"/>'
          )
        ),
        paragraph(run('Columns')),
        section('<w:type w:val="continuous"/><w:cols w:num="2" w:space="720"/><w:pgSz w:w="11906" w:h="16838"/>')
      ].join(''),
      {
        'word/header1.xml': `<w:hdr ${W}>${paragraph(run('First page header'))}</w:hdr>`,
        'word/footer1.xml': `<w:ftr ${W}>${paragraph(`${run('Page ')}<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>${run(' of ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`)}</w:ftr>`
      }
    )
    expect(look.pages).toHaveLength(2)
    const [cover, page] = look.pages
    // The first page shows the first page's header, and no footer, since the section gives none for it.
    expect(cover).toMatchObject({ width: 595.3, height: 841.9, number: '3', margins: { top: 72, left: 54, header: 35.4 }, footer: [] })
    expect(textOf(cover?.header[0] as DocumentParagraph)).toBe('First page header')
    expect(page).toMatchObject({ number: '4', header: [] })
    expect(
      (present(page?.footer[0]) as DocumentParagraph).spans.map((span) => ('text' in span ? span.text : 'field' in span ? `<${span.field}>` : ''))
    ).toEqual(['Page ', '<page>', ' of ', '<pages>'])
    expect(page?.bands.map((band) => [band.columns, band.gap, band.blocks.length])).toEqual([
      [1, 36, 1],
      [2, 36, 1]
    ])
  })

  it('shows links, hides hidden text and fields’ instructions, and puts footnotes at the foot of their page', async () => {
    const look = await lookOf(
      paragraph(
        `<w:hyperlink r:id="rLink">${run('a link')}</w:hyperlink>${run('hidden', '<w:vanish/>')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> DATE \\@ "d MMMM" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('19 November')}<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="2"/></w:r>`
      ),
      {
        'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:id="2">${paragraph(`<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>${run(' A note.')}`)}</w:footnote></w:footnotes>`
      }
    )
    const [read] = paragraphsOf(look)
    expect(read?.spans).toMatchObject([{ text: 'a link', link: 'https://example.org/' }, { text: '19 November' }, { note: 1, look: { position: 'super' } }])
    expect(look.pages[0]?.notes).toHaveLength(1)
    expect((present(look.pages[0]?.notes[0]?.blocks[0]) as DocumentParagraph).spans).toMatchObject([{ note: 1 }, { text: ' A note.' }])
  })

  it('places pictures in their line or floating, and boxes of text with their fill', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const picture = (holder: string) =>
      `<w:r><w:drawing>${holder.replace('{content}', '<wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Picture" descr="A blue square"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rPicture"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>')}</w:drawing></w:r>`
    const look = await lookOf(
      paragraph(
        picture('<wp:inline>{content}</wp:inline>') +
          picture(
            '<wp:anchor><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>{content}<wp:wrapSquare wrapText="bothSides"/></wp:anchor>'
          ) +
          picture(
            '<wp:anchor><wp:positionH relativeFrom="page"><wp:posOffset>127000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>254000</wp:posOffset></wp:positionV>{content}<wp:wrapNone/></wp:anchor>'
          ) +
          `<w:r><w:drawing><wp:inline><wp:extent cx="2540000" cy="1270000"/><wp:docPr id="4" name="Box"/><a:graphic><a:graphicData><wps:wsp xmlns:wps="wps"><wps:spPr><a:solidFill><a:srgbClr val="FFEEDD"/></a:solidFill></wps:spPr><wps:txbx><w:txbxContent>${paragraph(run('In a box'))}</w:txbxContent></wps:txbx><wps:bodyPr lIns="0"/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
      ),
      { 'word/media/picture.png': png }
    )
    const [read] = paragraphsOf(look)
    expect(read?.spans).toMatchObject([
      { placed: { figure: 0, alt: 'A blue square', width: 100, height: 50 } },
      { placed: { figure: 0, float: 'right' } },
      { placed: { figure: 0, at: { x: 10, y: 20, from: 'page' } } },
      { box: { width: 200, height: 100, fill: '#ffeedd', insets: { left: 0, right: 7.2 } } }
    ])
    const box = read?.spans[3]
    expect(box && 'box' in box ? textOf(box.box.blocks[0] as DocumentParagraph) : '').toBe('In a box')
  })

  it('reads no look from what is no Word document', async () => {
    expect(await readWordLook(archiveOf({}), new Figures(archiveOf({})))).toBeUndefined()
  })
})
