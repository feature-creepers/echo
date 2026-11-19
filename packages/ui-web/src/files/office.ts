/**
 * Previews of Office files, read in the window with well-known libraries: a Word document's text, tables and pictures
 * (mammoth), the cells of a spreadsheet of Excel or OpenDocument (SheetJS), and the text of each slide of a
 * PowerPoint presentation (JSZip and the window's XML parser). A preview shows what a file says, not how it looks:
 * its app shows that. Each library is loaded the first time a file of its kind is opened.
 */

/** The extensions previewed here. Older binary documents and presentations (.doc, .ppt) are opened with their app. */
export const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'xls', 'ods', 'pptx'])

/** How much of a sheet is shown: enough to recognise it, little enough to draw at once. */
export const MAX_ROWS = 500
export const MAX_COLUMNS = 50

export interface Sheet {
  name: string
  /** What each cell shows, formatted as the spreadsheet formats it, row by row. */
  rows: string[][]
  /** Whether the sheet holds more rows or columns than are shown. */
  cut: boolean
}

export interface Slide {
  title: string
  /** The slide's other text, a paragraph per line, in the order the slide holds it. */
  lines: string[]
}

export type OfficePreview =
  /** HTML as mammoth writes it: unsafe until sanitised, which the component that shows it does. */
  { kind: 'document'; html: string } | { kind: 'workbook'; sheets: Sheet[] } | { kind: 'presentation'; slides: Slide[] }

/** Read an Office file for its preview. Rejects with a sentence for the person when the file cannot be read. */
export async function readOffice(extension: string, bytes: Uint8Array): Promise<OfficePreview> {
  try {
    switch (extension) {
      case 'docx':
        return await readDocument(bytes)
      case 'xlsx':
      case 'xls':
      case 'ods':
        return await readWorkbook(bytes)
      case 'pptx':
        return await readPresentation(bytes)
    }
  } catch (error) {
    throw new Error(isProtected(extension, bytes) ? 'It is protected with a password.' : 'It could not be read.', { cause: error })
  }
  throw new Error(`There is no preview for .${extension} files.`)
}

async function readDocument(bytes: Uint8Array): Promise<OfficePreview> {
  const { default: mammoth } = await import('mammoth')
  // mammoth's browser build, which the window bundles, reads `arrayBuffer`; its Node build, which the tests load, `buffer`.
  const arrayBuffer = arrayBufferOf(bytes)
  const input = { arrayBuffer, buffer: arrayBuffer }
  const { value } = await mammoth.convertToHtml(input)
  return { kind: 'document', html: value }
}

async function readWorkbook(bytes: Uint8Array): Promise<OfficePreview> {
  const { read, utils } = await import('xlsx')
  // Rows past the limit are not even parsed; the sheet's full range says how far it went.
  const book = read(bytes, { type: 'array', sheetRows: MAX_ROWS, dense: true })
  const sheets = book.SheetNames.map((name): Sheet => {
    const sheet = book.Sheets[name]
    if (!sheet) return { name, rows: [], cut: false }
    const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: false, defval: '' })
    const range = sheet['!fullref'] ?? sheet['!ref']
    const full = range === undefined ? undefined : utils.decode_range(range)
    const cut = full !== undefined && (full.e.r - full.s.r + 1 > MAX_ROWS || full.e.c - full.s.c + 1 > MAX_COLUMNS)
    return { name, rows: rows.map((row) => row.slice(0, MAX_COLUMNS).map((cell) => String(cell ?? ''))), cut }
  })
  return { kind: 'workbook', sheets }
}

const PRESENTATION_NAMESPACE = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const DRAWING_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_RELATIONSHIP_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships'

async function readPresentation(bytes: Uint8Array): Promise<OfficePreview> {
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(bytes)
  const readXml = async (path: string): Promise<Document | undefined> => {
    const file = archive.file(path)
    return file ? new DOMParser().parseFromString(await file.async('text'), 'application/xml') : undefined
  }
  const presentation = await readXml('ppt/presentation.xml')
  const relationships = await readXml('ppt/_rels/presentation.xml.rels')
  if (!presentation || !relationships) throw new Error('This is not a PowerPoint presentation.')

  // The slides in the order the presentation lists them, which is not always the order of their file names.
  const targets = new Map<string, string>()
  for (const relationship of relationships.getElementsByTagNameNS(PACKAGE_RELATIONSHIP_NAMESPACE, 'Relationship')) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target) targets.set(id, target)
  }
  const slides: Slide[] = []
  for (const listed of presentation.getElementsByTagNameNS(PRESENTATION_NAMESPACE, 'sldId')) {
    const target = targets.get(listed.getAttributeNS(RELATIONSHIP_NAMESPACE, 'id') ?? '')
    const slide = target === undefined ? undefined : await readXml(partPath('ppt', target))
    if (slide) slides.push(slideText(slide))
  }
  return { kind: 'presentation', slides }
}

/** A slide's title, from its title placeholder, and the rest of its text, tables included. */
function slideText(slide: Document): Slide {
  const titleShape = [...slide.getElementsByTagNameNS(PRESENTATION_NAMESPACE, 'sp')].find((shape) => {
    const type = shape.getElementsByTagNameNS(PRESENTATION_NAMESPACE, 'ph')[0]?.getAttribute('type')
    return type === 'title' || type === 'ctrTitle'
  })
  const titleLines: string[] = []
  const lines: string[] = []
  for (const paragraph of slide.getElementsByTagNameNS(DRAWING_NAMESPACE, 'p')) {
    const text = [...paragraph.getElementsByTagNameNS(DRAWING_NAMESPACE, 't')]
      .map((run) => run.textContent ?? '')
      .join('')
      .trim()
    if (text === '') continue
    if (titleShape?.contains(paragraph)) titleLines.push(text)
    else lines.push(text)
  }
  return { title: titleLines.join(' '), lines }
}

/** The path of a part a relationship targets, from the folder of the part that holds the relationship. */
export function partPath(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = folder.split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

/**
 * A newer Office file saved with a password is an encrypted compound file rather than the ZIP archive Office writes
 * otherwise. An older workbook (.xls) is a compound file either way, so it says nothing there.
 */
const isProtected = (extension: string, bytes: Uint8Array) =>
  extension !== 'xls' && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0

/** The bytes as an ArrayBuffer of their own, which mammoth takes. */
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer
