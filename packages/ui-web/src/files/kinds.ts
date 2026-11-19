/**
 * What a file is, as the interface shows it: its kind in words, the short mark on its badge, and how it is
 * previewed. Read from its name, which is what every system goes by too.
 */

/**
 * How a file is previewed: rendered as the Prose block renders, as text, as a table, as a picture, as a document, as
 * the content of an Office file (Word, Excel, PowerPoint or an OpenDocument spreadsheet), or not at all.
 */
export type PreviewMode = 'markdown' | 'text' | 'csv' | 'image' | 'pdf' | 'office' | 'none'

export interface FileKind {
  /** In words, sentence case: "PNG image", "PDF document". */
  label: string
  preview: PreviewMode
}

const KINDS: Record<string, FileKind> = {
  md: { label: 'Markdown document', preview: 'markdown' },
  markdown: { label: 'Markdown document', preview: 'markdown' },
  txt: { label: 'Text', preview: 'text' },
  log: { label: 'Log', preview: 'text' },
  csv: { label: 'CSV table', preview: 'csv' },
  tsv: { label: 'TSV table', preview: 'csv' },
  json: { label: 'JSON data', preview: 'text' },
  yaml: { label: 'YAML data', preview: 'text' },
  yml: { label: 'YAML data', preview: 'text' },
  toml: { label: 'TOML data', preview: 'text' },
  xml: { label: 'XML document', preview: 'text' },
  html: { label: 'Web page', preview: 'text' },
  htm: { label: 'Web page', preview: 'text' },
  css: { label: 'Style sheet', preview: 'text' },
  js: { label: 'JavaScript source', preview: 'text' },
  mjs: { label: 'JavaScript source', preview: 'text' },
  ts: { label: 'TypeScript source', preview: 'text' },
  tsx: { label: 'TypeScript source', preview: 'text' },
  py: { label: 'Python source', preview: 'text' },
  rb: { label: 'Ruby source', preview: 'text' },
  go: { label: 'Go source', preview: 'text' },
  rs: { label: 'Rust source', preview: 'text' },
  java: { label: 'Java source', preview: 'text' },
  c: { label: 'C source', preview: 'text' },
  h: { label: 'C header', preview: 'text' },
  cpp: { label: 'C++ source', preview: 'text' },
  cs: { label: 'C# source', preview: 'text' },
  swift: { label: 'Swift source', preview: 'text' },
  kt: { label: 'Kotlin source', preview: 'text' },
  sh: { label: 'Shell script', preview: 'text' },
  ps1: { label: 'PowerShell script', preview: 'text' },
  bat: { label: 'Batch file', preview: 'text' },
  sql: { label: 'SQL', preview: 'text' },
  ini: { label: 'Settings', preview: 'text' },
  env: { label: 'Settings', preview: 'text' },
  png: { label: 'PNG image', preview: 'image' },
  jpg: { label: 'JPEG image', preview: 'image' },
  jpeg: { label: 'JPEG image', preview: 'image' },
  gif: { label: 'GIF image', preview: 'image' },
  webp: { label: 'WebP image', preview: 'image' },
  svg: { label: 'SVG image', preview: 'image' },
  bmp: { label: 'Bitmap image', preview: 'image' },
  avif: { label: 'AVIF image', preview: 'image' },
  ico: { label: 'Icon', preview: 'image' },
  pdf: { label: 'PDF document', preview: 'pdf' },
  doc: { label: 'Word document', preview: 'none' },
  docx: { label: 'Word document', preview: 'office' },
  xls: { label: 'Excel spreadsheet', preview: 'office' },
  xlsx: { label: 'Excel spreadsheet', preview: 'office' },
  ppt: { label: 'PowerPoint presentation', preview: 'none' },
  pptx: { label: 'PowerPoint presentation', preview: 'office' },
  odt: { label: 'OpenDocument text', preview: 'none' },
  ods: { label: 'OpenDocument spreadsheet', preview: 'office' },
  odp: { label: 'OpenDocument presentation', preview: 'none' },
  zip: { label: 'ZIP archive', preview: 'none' },
  gz: { label: 'Compressed file', preview: 'none' },
  tar: { label: 'Archive', preview: 'none' },
  '7z': { label: '7-Zip archive', preview: 'none' },
  mp3: { label: 'MP3 audio', preview: 'none' },
  wav: { label: 'WAV audio', preview: 'none' },
  m4a: { label: 'AAC audio', preview: 'none' },
  mp4: { label: 'MPEG-4 video', preview: 'none' },
  mov: { label: 'QuickTime video', preview: 'none' },
  webm: { label: 'WebM video', preview: 'none' }
}

/** The extension of a name, lower case, without its dot. Empty when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** What a file is, from its name. One whose extension says nothing is a file to open, not to preview. */
export function kindOf(name: string): FileKind {
  const extension = extensionOf(name)
  return KINDS[extension] ?? { label: extension === '' ? 'File' : `${extension.toUpperCase()} file`, preview: 'none' }
}

/** The mark on a file's badge: its extension, short enough for the badge. */
export function badgeOf(name: string): string {
  const extension = extensionOf(name)
  return extension === '' ? 'file' : extension.slice(0, 4)
}

/** The media type a preview of a file is made with. */
export function previewTypeOf(name: string): string {
  const extension = extensionOf(name)
  const images: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon'
  }
  return extension === 'pdf' ? 'application/pdf' : (images[extension] ?? 'application/octet-stream')
}
