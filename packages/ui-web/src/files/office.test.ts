import { describe, expect, it } from 'vitest'
import { columnOf, decodeEntities, openArchive, readOffice, xmlEvents } from './office.ts'

/** Deflate bytes as a ZIP archive stores them, with the window's own compression. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A ZIP archive of the parts given, each deflated, or stored when asked: enough of the format for a reader. */
async function zip(parts: Record<string, string>, stored = false): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(parts)) {
    const plain = encoder.encode(text)
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

  it('refuses what is not one', () => {
    expect(() => openArchive(new TextEncoder().encode('not an archive at all, just text'))).toThrow('not a ZIP archive')
  })
})

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
          cut: false
        }
      ]
    })
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
        { title: 'Welcome', lines: ['Ada & team'] },
        { title: 'Results', lines: ['Up 12%', 'Ahead of plan'] }
      ],
      cut: false
    })
  })

  it('says when a file is not what its name says', async () => {
    await expect(readOffice('docx', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not a Word document')
    await expect(readOffice('xlsx', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not an Excel workbook')
    await expect(readOffice('pptx', await zip({ 'other.xml': '<a/>' }))).rejects.toThrow('not a PowerPoint presentation')
  })
})
