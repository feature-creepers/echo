import { describe, expect, it } from 'vitest'
import { textOf } from './archive.ts'
import { columnOf, decodeEntities, openArchive, readOffice, xmlEvents } from './office.ts'

/** Deflate bytes as a ZIP archive stores them, with the window's own compression. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A ZIP archive of the parts given, each deflated, or stored when asked: enough of the format for a reader. */
async function zip(parts: Record<string, string | Uint8Array>, stored = false): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(parts)) {
    const plain = typeof content === 'string' ? encoder.encode(content) : content
    const data = stored ? plain : await deflate(plain)
    const named = encoder.encode(name)
    const local = new Uint8Array(30 + named.length + data.length)
    const head = new DataView(local.buffer)
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(8, stored ? 0 : 8, true)
    head.setUint32(18, data.length, true)
    head.setUint32(22, plain.length, true)
    head.setUint16(26, named.length, true)
    local.set(named, 30)
    local.set(data, 30 + named.length)
    const entry = new Uint8Array(46 + named.length)
    const central = new DataView(entry.buffer)
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(10, stored ? 0 : 8, true)
    central.setUint32(20, data.length, true)
    central.setUint32(24, plain.length, true)
    central.setUint16(28, named.length, true)
    central.setUint32(42, offset, true)
    entry.set(named, 46)
    locals.push(local)
    directory.push(entry)
    offset += local.length
  }
  const size = directory.reduce((sum, one) => sum + one.length, 0)
  const end = new Uint8Array(22)
  const tail = new DataView(end.buffer)
  tail.setUint32(0, 0x06054b50, true)
  tail.setUint16(8, directory.length, true)
  tail.setUint16(10, directory.length, true)
  tail.setUint32(12, size, true)
  tail.setUint32(16, offset, true)
  const whole = new Uint8Array(offset + size + 22)
  let at = 0
  for (const part of [...locals, ...directory, end]) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const paragraph = (text: string, properties = '') => `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

describe('XML as the Office formats write it', () => {
  it('reads elements, attributes, text and entities, and passes over the rest', () => {
    const events = [...xmlEvents('<?xml version="1.0"?><!-- note --><a x="1" y=\'&lt;2&gt;\'><b/>caf&#233; &amp; th&#xE9;<![CDATA[<raw>]]></a>')]
    expect(events).toEqual([
      { type: 'open', name: 'a', attributes: { x: '1', y: '<2>' } },
      { type: 'open', name: 'b', attributes: {} },
      { type: 'close', name: 'b' },
      { type: 'text', text: 'café & thé' },
      { type: 'text', text: '<raw>' },
      { type: 'close', name: 'a' }
    ])
    expect(decodeEntities('&unknown; &#99999999;')).toBe('&unknown; &#99999999;')
  })

  it.each([
    ['A1', 0],
    ['Z9', 25],
    ['AA1', 26],
    ['AB7', 27]
  ])('finds the column of %s', (reference, column) => {
    expect(columnOf(reference)).toBe(column)
  })
})

describe('a ZIP archive', () => {
  it('unpacks parts stored and deflated', async () => {
    for (const stored of [true, false]) {
      const archive = openArchive(await zip({ 'a.txt': 'hello', 'folder/b.txt': 'é' }, stored))
      expect([...archive.keys()]).toEqual(['a.txt', 'folder/b.txt'])
      expect(new TextDecoder().decode(await archive.get('folder/b.txt')?.())).toBe('é')
    }
  })

  it('finds a part whatever its capitals, as the Office formats name them', async () => {
    const archive = openArchive(await zip({ 'xl/worksheets/Sheet1.xml': 'sheet', 'xl/worksheets/_rels/sheet1.xml.rels': 'links' }))
    expect(await textOf(archive, 'xl/worksheets/sheet1.xml')).toBe('sheet')
    expect(await textOf(archive, 'xl/worksheets/_rels/Sheet1.xml.rels')).toBe('links')
    expect(await textOf(archive, 'xl/worksheets/Sheet2.xml')).toBeUndefined()
  })

  it('refuses what is not one', () => {
    expect(() => openArchive(new TextEncoder().encode('not an archive at all, just text'))).toThrow('not a ZIP archive')
  })
})

/** A picture's bytes, as PNG starts. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
/** A picture the window does not show: an EMF's first bytes. */
const EMF = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00])

/** A chart of DrawingML with one series, as saved with the values it drew. */
const CHART =
  '<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Costs</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:lineChart><c:ser>' +
  '<c:tx><c:v>Euros</c:v></c:tx><c:cat><c:strLit><c:pt idx="0"><c:v>Train</c:v></c:pt><c:pt idx="1"><c:v>Hotel</c:v></c:pt></c:strLit></c:cat>' +
  '<c:val><c:numLit><c:pt idx="0"><c:v>42.5</c:v></c:pt><c:pt idx="1"><c:v>120</c:v></c:pt></c:numLit></c:val></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>'

const COSTS = {
  kind: 'chart',
  title: 'Costs',
  chart: 'line',
  series: [
    {
      name: 'Euros',
      points: [
        { x: 'Train', y: 42.5 },
        { x: 'Hotel', y: 120 }
      ]
    }
  ]
}

/** A picture placed inline in a Word paragraph, sized in English Metric Units. */
const inlinePicture = (id: string, alt: string) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="${alt}"/>` +
  `<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`

describe('an Office file previewed', () => {
  it('shows a Word document as Markdown: headings by their style, lists, line breaks, tables, marks escaped', async () => {
    const styles = `<w:styles ${W}><w:style w:styleId="Titre1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`
    const body = [
      paragraph('Trip to Rome', '<w:pPr><w:pStyle w:val="Title"/></w:pPr>'),
      paragraph('Day one', '<w:pPr><w:pStyle w:val="Titre1"/></w:pPr>'),
      paragraph('Visit the *Forum* &amp; eat'),
      '<w:p><w:r><w:t>First line</w:t><w:br/><w:t>second</w:t></w:r></w:p>',
      paragraph('Tickets', '<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>'),
      paragraph('   '),
      `<w:tbl><w:tr><w:tc>${paragraph('Day')}</w:tc><w:tc>${paragraph('Cost')}</w:tc></w:tr><w:tr><w:tc>${paragraph('1')}</w:tc><w:tc>${paragraph('40 | 50')}</w:tc></w:tr></w:tbl>`
    ].join('')
    const file = await zip({ 'word/document.xml': `<w:document ${W}><w:body>${body}</w:body></w:document>`, 'word/styles.xml': styles })
    expect(await readOffice('docx', file)).toEqual({
      kind: 'document',
      markdown: [
        '# Trip to Rome',
        '# Day one',
        'Visit the \\*Forum\\* & eat',
        'First line  \nsecond',
        '- Tickets',
        '| Day | Cost |\n| --- | --- |\n| 1 | 40 \\| 50 |'
      ].join('\n\n'),
      figures: [],
      cut: false
    })
  })

  it('shows an Excel workbook as tables: shared and inline text, numbers, booleans, columns lined up', async () => {
    const file = await zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Gone" sheetId="2" r:id="rId9"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><r><t>Ho</t></r><r><t>tel</t></r><rPh><t>ほてる</t></rPh></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Paid</t></is></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>120.5</v></c><c r="C3" t="b"><v>1</v></c></row></sheetData></worksheet>'
    })
    expect(await readOffice('xlsx', file)).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Budget',
          rows: [['Item', '', 'Paid'], [], ['Hotel', '120.5', 'TRUE']],
          cut: false,
          figures: []
        }
      ]
    })
  })

  it('shows each number of a workbook as the format of its style shows it, and its dates as the workbook counts them', async () => {
    const workbook = (properties: string) =>
      zip({
        'xl/workbook.xml': `<workbook>${properties}<sheets><sheet name="Numbers" r:id="rId1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="styles.xml"/></Relationships>',
        'xl/styles.xml':
          '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellStyleXfs count="1"><xf numFmtId="164"/></cellStyleXfs>' +
          '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="3"/></cellXfs></styleSheet>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>45234</v></c><c r="B1" s="2"><v>0.256</v></c><c r="C1" s="3"><v>1234567</v></c>' +
          '<c r="D1"><v>1589036664.030000</v></c><c r="E1" t="e"><v>#N/A</v></c><c r="F1" t="str" s="1"><v>text</v></c></row></sheetData></worksheet>'
      })
    const rows = async (properties: string) => {
      const read = await readOffice('xlsx', await workbook(properties), { locale: 'en-US' })
      return read.kind === 'workbook' ? read.sheets[0]?.rows : undefined
    }
    expect(await rows('')).toEqual([['04/11/2023', '25.60%', '1,234,567', '1589036664', '#N/A', 'text']])
    expect((await rows('<workbookPr date1904="1"/>'))?.[0]?.[0]).toBe('05/11/2027')
  })

  it('shows a PowerPoint presentation as its slides, in their order: each title, then its text', async () => {
    const slide = (title: string, ...lines: string[]) =>
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
      `<p:sp><p:txBody>${lines.map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join('')}<a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    const file = await zip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="/ppt/slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slide('Results', 'Up 12%', 'Ahead of plan'),
      'ppt/slides/slide2.xml': slide('Welcome', 'Ada &amp; team')
    })
    expect(await readOffice('pptx', file)).toEqual({
      kind: 'presentation',
      slides: [
        { title: 'Welcome', lines: ['Ada & team'], figures: [] },
        { title: 'Results', lines: ['Up 12%', 'Ahead of plan'], figures: [] }
      ],
      cut: false
    })
  })

  it('shows a Word document with its format, links, numbered lists, pictures and charts, and passes over what is kept for older apps', async () => {
    const run = (text: string, format = '') => `<w:r>${format === '' ? '' : `<w:rPr>${format}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`
    const body = [
      `<w:p>${run('A ')}${run('bold', '<w:b/>')}${run(' and ')}${run('slanted', '<w:i/>')}${run(' word, ')}${run('not bold', '<w:b w:val="0"/>')}${run(', ')}${run('gone', '<w:strike/>')}${run(', ')}${run('strong', '<w:rStyle w:val="Strong"/>')}</w:p>`,
      `<w:p>${run('See ')}<w:hyperlink r:id="rId9">${run('the site')}</w:hyperlink>${run(' or ')}<w:hyperlink w:anchor="end">${run('the end')}</w:hyperlink></w:p>`,
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run('First')}</w:p>`,
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run('Second')}</w:p>`,
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${run('Out of the list')}</w:p>`,
      `<w:p>${inlinePicture('rId5', 'The old town')}</w:p>`,
      `<w:p>${run('Again: ')}${inlinePicture('rId5', 'The old town')}${inlinePicture('rId6', 'A drawing')}</w:p>`,
      '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="c14"><w:drawing><wp:inline><wp:docPr id="3" name="Chart 3"/><a:graphic><a:graphicData>' +
        '<c:chart r:id="rId7"/></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:imagedata r:id="rId6"/></w:pict>' +
        '<w:t>Fallback text</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>',
      `<w:tbl><w:tr><w:tc><w:p>${run('Bold cell', '<w:b/>')}</w:p></w:tc><w:tc><w:p>${inlinePicture('rId5', 'Small')}</w:p></w:tc></w:tr></w:tbl>`
    ].join('')
    const file = await zip({
      'word/document.xml': `<w:document ${W}><w:body>${body}</w:body></w:document>`,
      'word/styles.xml': `<w:styles ${W}><w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="Base"/></w:style><w:style w:type="character" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style></w:styles>`,
      'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="7"/></w:num></w:numbering>`,
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship Id="rId5" Target="media/image1.png"/><Relationship Id="rId6" Target="media/image2.emf"/>' +
        '<Relationship Id="rId7" Target="charts/chart1.xml"/><Relationship Id="rId9" Target="https://example.org/" TargetMode="External"/></Relationships>',
      'word/media/image1.png': PNG,
      'word/media/image2.emf': EMF,
      'word/charts/chart1.xml': CHART
    })
    expect(await readOffice('docx', file)).toEqual({
      kind: 'document',
      markdown: [
        'A **bold** and _slanted_ word, not bold, ~~gone~~, **strong**',
        'See [the site](https://example.org/) or [the end](#end)',
        '1. First\n1. Second',
        'Out of the list',
        '![The old town](figure:0)',
        'Again: ![The old town](figure:0)![A drawing](figure:1)',
        '![](figure:2)',
        '| **Bold cell** | ![Small](figure:3) |\n| --- | --- |'
      ].join('\n\n'),
      figures: [
        { kind: 'picture', type: 'image/png', bytes: PNG, alt: 'The old town', width: 200, height: 100 },
        { kind: 'unshown', alt: 'A drawing', what: 'picture' },
        { ...COSTS },
        { kind: 'picture', type: 'image/png', bytes: PNG, alt: 'Small', width: 200, height: 100 }
      ],
      cut: false
    })
  })

  it('shows the pictures and charts of a workbook’s sheets and of a presentation’s slides, in order, without a slide’s background', async () => {
    const workbook = await zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Item</t></is></c></row></sheetData><drawing r:id="rId3"/></worksheet>',
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rId3" Target="../drawings/drawing1.xml"/></Relationships>',
      'xl/drawings/drawing1.xml':
        '<xdr:wsDr><xdr:twoCellAnchor><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/></xdr:nvGraphicFramePr>' +
        '<a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>' +
        '<xdr:oneCellAnchor><xdr:ext cx="952500" cy="952500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Logo" descr="Our logo"/></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>',
      'xl/drawings/_rels/drawing1.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="../charts/chart1.xml"/><Relationship Id="rId2" Target="../media/image1.png"/></Relationships>',
      'xl/charts/chart1.xml': CHART,
      'xl/media/image1.png': PNG
    })
    expect(await readOffice('xlsx', workbook)).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Budget',
          rows: [['Item']],
          cut: false,
          figures: [{ ...COSTS }, { kind: 'picture', type: 'image/png', bytes: PNG, alt: 'Our logo', width: 100, height: 100 }]
        }
      ]
    })

    const presentation = await zip({
      'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml':
        '<p:sld><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId4"/></a:blipFill></p:bgPr></p:bg><p:spTree>' +
        '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Budget</a:t></a:r></a:p></p:txBody></p:sp>' +
        '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" title="A view"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"><a:extLst><a:ext uri="{x}"/></a:extLst></a:blip></p:blipFill>' +
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2857500" cy="1905000"/></a:xfrm></p:spPr></p:pic>' +
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart 4"/></p:nvGraphicFramePr><a:graphic><a:graphicData><c:chart r:id="rId5"/></a:graphicData></a:graphic></p:graphicFrame>' +
        '</p:spTree></p:cSld></p:sld>',
      'ppt/slides/_rels/slide1.xml.rels':
        '<Relationships><Relationship Id="rId4" Target="../media/image1.png"/><Relationship Id="rId5" Target="../charts/chart1.xml"/></Relationships>',
      'ppt/media/image1.png': PNG,
      'ppt/charts/chart1.xml': CHART
    })
    expect(await readOffice('pptx', presentation)).toEqual({
      kind: 'presentation',
      slides: [
        {
          title: 'Budget',
          lines: [],
          figures: [{ kind: 'picture', type: 'image/png', bytes: PNG, alt: 'A view', width: 300, height: 200 }, { ...COSTS }]
        }
      ],
      cut: false
    })
  })

  it('draws a chart that kept no values, as some programs write them, from the cells of the sheets it names', async () => {
    const formula = (kind: string, reference: string) => `<c:${kind}Ref><c:f>${reference}</c:f></c:${kind}Ref>`
    const file = await zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Chart" r:id="rId1"/><sheet name="Visits by month" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData/><drawing r:id="rId1"/></worksheet>',
      'xl/worksheets/_rels/sheet1.xml.rels': '<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>',
      'xl/worksheets/sheet2.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1" t="inlineStr"><is><t>Visits</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>May</t></is></c><c r="B2"><v>1200</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>June</t></is></c><c r="B3"><v>1500</v></c></row></sheetData></worksheet>',
      'xl/drawings/drawing1.xml':
        '<xdr:wsDr><xdr:twoCellAnchor><xdr:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor></xdr:wsDr>',
      'xl/drawings/_rels/drawing1.xml.rels': '<Relationships><Relationship Id="rId1" Target="../charts/chart1.xml"/></Relationships>',
      'xl/charts/chart1.xml':
        `<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:tx>${formula('str', "'Visits by month'!$B$1")}</c:tx>` +
        `<c:cat>${formula('str', "'Visits by month'!$A$2:$A$3")}</c:cat><c:val>${formula('num', "'Visits by month'!$B$2:$B$3")}</c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`
    })
    const read = await readOffice('xlsx', file)
    expect(read.kind === 'workbook' ? read.sheets[0]?.figures : undefined).toEqual([
      {
        kind: 'chart',
        title: '',
        chart: 'bar',
        series: [
          {
            name: 'Visits',
            points: [
              { x: 'May', y: 1200 },
              { x: 'June', y: 1500 }
            ]
          }
        ]
      }
    ])
  })

  it('says when a file is not what its name says', async () => {
    await expect(readOffice('docx', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not a Word document')
    await expect(readOffice('xlsx', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not an Excel workbook')
    await expect(readOffice('pptx', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not a PowerPoint presentation')
  })
})

/** An OpenDocument's content part: its automatic styles, then its body. */
const odf = (styles: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3">` +
  `<office:automatic-styles>${styles}</office:automatic-styles><office:body>${body}</office:body></office:document-content>`

describe('an OpenDocument file previewed', () => {
  it('shows a text as Markdown: headings by level and by style, lists, spaces, line breaks, tables, without notes or comments', async () => {
    const body = [
      '<text:p text:style-name="P1">Trip to Rome</text:p>',
      '<text:h text:style-name="Heading_20_2" text:outline-level="2">Day <text:span>one</text:span></text:h>',
      '<text:p>Visit the *Forum*<text:note><text:note-citation>1</text:note-citation><text:note-body><text:p>A note</text:p></text:note-body></text:note> &amp; eat<office:annotation><text:p>Comment</text:p></office:annotation></text:p>',
      '<text:p>Two<text:s text:c="2"/>spaces<text:tab/>and<text:line-break/>a break</text:p>',
      '<text:list><text:list-item><text:p>Tickets</text:p><text:list><text:list-item><text:p>Museum</text:p></text:list-item></text:list></text:list-item></text:list>',
      '<text:p>   </text:p>',
      '<text:p><draw:frame><draw:text-box><text:p>In a frame</text:p></draw:text-box></draw:frame></text:p>',
      '<table:table><table:table-row><table:table-cell><text:p>Day</text:p></table:table-cell><table:table-cell><text:p>Cost</text:p></table:table-cell></table:table-row>' +
        '<table:table-row><table:table-cell><text:p>1</text:p></table:table-cell><table:table-cell><text:p>40 | 50</text:p></table:table-cell></table:table-row></table:table>'
    ].join('\n')
    const file = await zip({
      mimetype: 'application/vnd.oasis.opendocument.text',
      'content.xml': odf('<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Title"/>', `<office:text>${body}</office:text>`)
    })
    expect(await readOffice('odt', file)).toEqual({
      kind: 'document',
      markdown: [
        '# Trip to Rome',
        '## Day one',
        'Visit the \\*Forum\\* & eat',
        'Two  spaces\tand  \na break',
        '- Tickets\n  - Museum',
        '| Day | Cost |\n| --- | --- |\n| 1 | 40 \\| 50 |'
      ].join('\n\n'),
      figures: [],
      cut: false
    })
  })

  it('shows a spreadsheet as tables: the text each cell shows, repeated cells and rows, and not the empty end of a sheet', async () => {
    const cell = (text: string, more = '') => `<table:table-cell office:value-type="string"${more}><text:p>${text}</text:p></table:table-cell>`
    const empty = (repeated: number) => `<table:table-cell table:number-columns-repeated="${repeated}"/>`
    const sheet =
      '<table:table table:name="Budget"><table:table-column table:number-columns-repeated="1024"/>' +
      `<table:table-row>${cell('Item')}${empty(1)}${cell('Paid')}${empty(16381)}</table:table-row>` +
      `<table:table-row table:number-rows-repeated="1">${empty(1024)}</table:table-row>` +
      `<table:table-row>${cell('Hotel')}<table:table-cell office:value-type="float" office:value="120.5"><text:p>120,50 €</text:p></table:table-cell>` +
      `<table:table-cell office:value-type="boolean" office:boolean-value="true"/>${empty(1021)}</table:table-row>` +
      `<table:table-row table:number-rows-repeated="2">${cell('Same', ' table:number-columns-repeated="2"')}</table:table-row>` +
      `<table:table-row table:number-rows-repeated="1048570">${empty(1024)}</table:table-row></table:table>` +
      `<table:table table:name="Empty"><table:table-row>${empty(5)}</table:table-row></table:table>`
    const file = await zip({ 'content.xml': odf('', `<office:spreadsheet>${sheet}</office:spreadsheet>`) })
    expect(await readOffice('ods', file)).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Budget',
          rows: [['Item', '', 'Paid'], [], ['Hotel', '120,50 €', 'TRUE'], ['Same', 'Same'], ['Same', 'Same']],
          cut: false,
          figures: []
        },
        { name: 'Empty', rows: [], cut: false, figures: [] }
      ]
    })
  })

  it('cuts a sheet past its rows and columns shown, and says so', async () => {
    const row =
      '<table:table-row table:number-rows-repeated="600"><table:table-cell table:number-columns-repeated="80"><text:p>x</text:p></table:table-cell></table:table-row>'
    const file = await zip({ 'content.xml': odf('', `<office:spreadsheet><table:table table:name="Big">${row}</table:table></office:spreadsheet>`) })
    const preview = await readOffice('ods', file)
    if (preview.kind !== 'workbook') throw new Error('Not a workbook.')
    expect(preview.sheets[0]?.rows).toHaveLength(500)
    expect(preview.sheets[0]?.rows[0]).toHaveLength(50)
    expect(preview.sheets[0]?.cut).toBe(true)
  })

  it('shows a presentation as its slides, in order: each title, then its text, without its notes', async () => {
    const frame = (kind: string, ...lines: string[]) =>
      `<draw:frame presentation:class="${kind}"><draw:text-box>${lines.map((line) => `<text:p>${line}</text:p>`).join('')}</draw:text-box></draw:frame>`
    const page = (name: string, title: string, ...lines: string[]) =>
      `<draw:page draw:name="${name}">${frame('title', title)}${frame('outline', ...lines)}<draw:custom-shape><text:p>In a shape</text:p></draw:custom-shape>` +
      '<presentation:notes><draw:frame><draw:text-box><text:p>Speaker notes</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>'
    const file = await zip({
      'content.xml': odf(
        '',
        `<office:presentation>${page('one', 'Welcome', 'Ada &amp; team')}${page('two', 'Results', 'Up 12%', 'Ahead of plan')}</office:presentation>`
      )
    })
    expect(await readOffice('odp', file)).toEqual({
      kind: 'presentation',
      slides: [
        { title: 'Welcome', lines: ['Ada & team', 'In a shape'], figures: [] },
        { title: 'Results', lines: ['Up 12%', 'Ahead of plan', 'In a shape'], figures: [] }
      ],
      cut: false
    })
  })

  it('shows a text with its format, links, numbered lists, and the pictures and charts its frames show, not the text of a frame', async () => {
    const styles =
      '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
      '<style:style style:name="T2" style:family="text" style:parent-style-name="Emphasis"/>' +
      '<style:style style:name="T3" style:family="text"><style:text-properties style:text-line-through-style="solid" fo:font-weight="normal"/></style:style>' +
      '<style:style style:name="P1" style:family="paragraph"><style:text-properties fo:font-weight="700"/></style:style>' +
      '<text:list-style style:name="L1"><text:list-level-style-number text:level="1"/><text:list-level-style-bullet text:level="2"/></text:list-style>'
    const frame = (inside: string, more = '') => `<draw:frame draw:name="Image1" svg:width="5.08cm" svg:height="2.54cm"${more}>${inside}</draw:frame>`
    const body = [
      '<text:p>A <text:span text:style-name="T1">bold</text:span> and <text:span text:style-name="T2">slanted</text:span> word, <text:span text:style-name="T3">gone</text:span>.</text:p>',
      '<text:p text:style-name="P1">All bold, <text:span text:style-name="T3">but this</text:span></text:p>',
      '<text:p>See <text:a xlink:href="https://example.org/">the site</text:a></text:p>',
      '<text:list text:style-name="L1"><text:list-item><text:p>First</text:p><text:list><text:list-item><text:p>Inner</text:p></text:list-item></text:list></text:list-item>' +
        '<text:list-item><text:p>Second</text:p></text:list-item></text:list>',
      `<text:p>${frame('<draw:image xlink:href="Pictures/1.png"/><svg:title>A map</svg:title>')}</text:p>`,
      `<text:p>${frame('<draw:object xlink:href="./Object 1"/><draw:image xlink:href="./ObjectReplacements/Object 1"/>')}</text:p>`,
      `<text:p>${frame('<draw:object xlink:href="./Object 2"/>')}${frame('<draw:text-box><text:p>In a frame</text:p></draw:text-box>')}</text:p>`
    ].join('')
    const file = await zip({
      'styles.xml':
        '<office:document-styles><office:styles><style:style style:name="Emphasis" style:family="text"><style:text-properties fo:font-style="italic"/></style:style></office:styles></office:document-styles>',
      'content.xml': odf(styles, `<office:text>${body}</office:text>`),
      'Pictures/1.png': PNG,
      'Object 1/content.xml':
        '<office:document-content><office:body><office:chart><chart:chart chart:class="chart:bar"><table:table table:name="local-table">' +
        '<table:table-row><table:table-cell/><table:table-cell><text:p>Euros</text:p></table:table-cell></table:table-row>' +
        '<table:table-row><table:table-cell><text:p>Train</text:p></table:table-cell><table:table-cell office:value="42.5"/></table:table-row>' +
        '</table:table></chart:chart></office:chart></office:body></office:document-content>',
      'Object 2/content.xml': '<office:document-content><office:body><office:formula><math/></office:formula></office:body></office:document-content>'
    })
    expect(await readOffice('odt', file)).toEqual({
      kind: 'document',
      markdown: [
        'A **bold** and _slanted_ word, ~~gone~~.',
        '**All bold,** ~~but this~~',
        'See [the site](https://example.org/)',
        '1. First\n  - Inner\n1. Second',
        '![A map](figure:0)',
        '![](figure:1)'
      ].join('\n\n'),
      figures: [
        { kind: 'picture', type: 'image/png', bytes: PNG, alt: 'A map', width: 192, height: 96 },
        { kind: 'chart', title: '', chart: 'bar', series: [{ name: 'Euros', points: [{ x: 'Train', y: 42.5 }] }] }
      ],
      cut: false
    })
  })

  it('shows the pictures of a spreadsheet’s sheets and of a presentation’s slides, without those of its notes', async () => {
    const picture = (alt: string) =>
      `<draw:frame svg:width="1in" svg:height="1in"><draw:image xlink:href="Pictures/1.png"/><svg:desc>${alt}</svg:desc></draw:frame>`
    const spreadsheet = await zip({
      'content.xml': odf(
        '',
        '<office:spreadsheet><table:table table:name="One"><table:shapes>' +
          picture('A logo') +
          '</table:shapes><table:table-row><table:table-cell><text:p>x</text:p></table:table-cell></table:table-row></table:table>' +
          '<table:table table:name="Two"><table:table-row><table:table-cell><text:p>y</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'
      ),
      'Pictures/1.png': PNG
    })
    const logo = { kind: 'picture', type: 'image/png', bytes: PNG, alt: 'A logo', width: 96, height: 96 }
    expect(await readOffice('ods', spreadsheet)).toEqual({
      kind: 'workbook',
      sheets: [
        { name: 'One', rows: [['x']], cut: false, figures: [logo] },
        { name: 'Two', rows: [['y']], cut: false, figures: [] }
      ]
    })

    const presentation = await zip({
      'content.xml': odf(
        '',
        '<office:presentation><draw:page draw:name="one"><draw:frame presentation:class="title"><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame>' +
          `${picture('A logo')}<presentation:notes>${picture('In the notes')}</presentation:notes></draw:page></office:presentation>`
      ),
      'Pictures/1.png': PNG
    })
    expect(await readOffice('odp', presentation)).toEqual({ kind: 'presentation', slides: [{ title: 'Hello', lines: [], figures: [logo] }], cut: false })
  })

  it('says when a file is protected with a password, as its manifest says its content is encrypted', async () => {
    const manifest = (inside: string) =>
      `<manifest:manifest><manifest:file-entry manifest:full-path="/"/><manifest:file-entry manifest:full-path="content.xml">${inside}</manifest:file-entry></manifest:manifest>`
    const file = await zip({
      'content.xml': 'encrypted bytes',
      'META-INF/manifest.xml': manifest('<manifest:encryption-data manifest:checksum="x"><manifest:algorithm/></manifest:encryption-data>')
    })
    await expect(readOffice('odt', file)).rejects.toThrow('protected with a password')
    const open = await zip({ 'content.xml': odf('', '<office:text><text:p>Open</text:p></office:text>'), 'META-INF/manifest.xml': manifest('') })
    expect(await readOffice('odt', open)).toMatchObject({ markdown: 'Open' })
  })

  it('says when a file is not an OpenDocument', async () => {
    await expect(readOffice('odt', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not an OpenDocument text')
    await expect(readOffice('ods', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not an OpenDocument spreadsheet')
    await expect(readOffice('odp', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not an OpenDocument presentation')
  })
})
