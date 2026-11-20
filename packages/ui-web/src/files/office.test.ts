// @vitest-environment jsdom
// A presentation's slides are read with the window's XML parser, which jsdom provides here.
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { MAX_ROWS, partPath, readOffice } from './office.ts'

const zip = async (files: Record<string, string>): Promise<Uint8Array> => {
  const archive = new JSZip()
  for (const [path, text] of Object.entries(files)) archive.file(path, text)
  return archive.generateAsync({ type: 'uint8array' })
}

const WORD = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

const docx = () =>
  zip({
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/styles.xml': `<?xml version="1.0"?><w:styles ${WORD}>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
    'word/document.xml': `<?xml version="1.0"?><w:document ${WORD}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Trip</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Leave</w:t></w:r><w:r><w:t xml:space="preserve"> at nine.</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Day</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Place</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`
  })

const PRESENTATION = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const DRAWING = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const RELATIONSHIPS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

const shape = (placeholder: string | undefined, ...paragraphs: string[]) =>
  `<p:sp><p:nvSpPr><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs
    .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sp>`

const slide = (...shapes: string[]) => `<?xml version="1.0"?><p:sld ${PRESENTATION} ${DRAWING}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`

const pptx = () =>
  zip({
    // The second slide file is listed first: the list, not the file names, gives the order.
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${PRESENTATION} ${RELATIONSHIPS}>
      <p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId3" Type="slide" Target="/ppt/slides/slide2.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': slide(shape('title', 'Plan'), shape(undefined, 'Book the train', '', 'Pack')),
    'ppt/slides/slide2.xml': slide(shape('ctrTitle', 'Our trip', 'to Lyon'), shape('subTitle', 'November'))
  })

const workbook = (bookType: 'xlsx' | 'ods' | 'biff8', rows: unknown[][], format?: string): Uint8Array => {
  const sheet = utils.aoa_to_sheet(rows)
  if (format) for (const cell of Object.values(sheet)) if (typeof cell === 'object' && cell && 't' in cell && cell.t === 'n') cell.z = format
  const book = utils.book_new()
  utils.book_append_sheet(book, sheet, 'Budget')
  return new Uint8Array(write(book, { type: 'array', bookType }))
}

// Each library is loaded the first time a file of its kind is read; cold, in a full parallel run, mammoth alone can
// take longer than the default five seconds.
describe('readOffice', { timeout: 30_000 }, () => {
  it('reads a Word document as HTML with its headings, emphasis and tables', async () => {
    const preview = await readOffice('docx', await docx())
    expect(preview.kind).toBe('document')
    if (preview.kind !== 'document') return
    expect(preview.html).toContain('<h1>Trip</h1>')
    expect(preview.html).toContain('<strong>Leave</strong> at nine.')
    expect(preview.html).toMatch(/<table>.*Day.*Place.*<\/table>/s)
  })

  it.each([
    ['xlsx', 'xlsx'],
    ['ods', 'ods'],
    ['xls', 'biff8']
  ] as const)('reads a .%s workbook as the text of its cells', async (extension, bookType) => {
    const preview = await readOffice(
      extension,
      workbook(bookType, [
        ['Item', 'Amount'],
        ['Rent', 1200]
      ])
    )
    expect(preview).toEqual({
      kind: 'workbook',
      sheets: [
        {
          name: 'Budget',
          rows: [
            ['Item', 'Amount'],
            ['Rent', '1200']
          ],
          cut: false
        }
      ]
    })
  })

  it('shows numbers as their format shows them', async () => {
    const preview = await readOffice('xlsx', workbook('xlsx', [['Rent', 1200.5]], '#,##0.00'))
    expect(preview.kind === 'workbook' && preview.sheets[0]?.rows).toEqual([['Rent', '1,200.50']])
  })

  it('cuts a long sheet and says so', async () => {
    const rows = Array.from({ length: MAX_ROWS + 20 }, (_, index) => [`Row ${index + 1}`])
    const preview = await readOffice('xlsx', workbook('xlsx', rows))
    expect(preview.kind === 'workbook' && preview.sheets[0]?.rows.length).toBe(MAX_ROWS)
    expect(preview.kind === 'workbook' && preview.sheets[0]?.cut).toBe(true)
  })

  it('reads a presentation slide by slide, in the order it lists them, with each title', async () => {
    expect(await readOffice('pptx', await pptx())).toEqual({
      kind: 'presentation',
      slides: [
        { title: 'Our trip to Lyon', lines: ['November'] },
        { title: 'Plan', lines: ['Book the train', 'Pack'] }
      ]
    })
  })

  it.each([
    ['docx', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), 'It is protected with a password.'],
    ['pptx', new Uint8Array([1, 2, 3]), 'It could not be read.'],
    ['doc', new Uint8Array([1, 2, 3]), 'There is no preview for .doc files.']
  ])('says why a .%s file cannot be previewed', async (extension, bytes, why) => {
    await expect(readOffice(extension, bytes)).rejects.toThrow(why)
  })
})

describe('partPath', () => {
  it.each([
    ['ppt', 'slides/slide1.xml', 'ppt/slides/slide1.xml'],
    ['ppt', '/ppt/slides/slide1.xml', 'ppt/slides/slide1.xml'],
    ['ppt/slides', '../media/image1.png', 'ppt/media/image1.png'],
    ['ppt', './slides/slide2.xml', 'ppt/slides/slide2.xml']
  ])('resolves %s + %s', (folder, target, path) => {
    expect(partPath(folder, target)).toBe(path)
  })
})
