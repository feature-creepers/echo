/**
 * Metafiles drawn as SVG, in the window itself, with no library (docs/SPEC.md, section 9.7). A metafile records the
 * drawing calls of Windows that make a picture: WMF in 16-bit records, EMF in 32-bit ones. Office keeps its vector
 * pictures so, an object's picture among them: a chart of Microsoft Graph, an equation, a clip art. Each record is
 * played on a state of its own, as Windows plays it: its pens, brushes and fonts, its mapping from the picture's units
 * to the device's, its paths and its clipping. Shapes are written as SVG paths in the device's units, text and bitmaps
 * placed by the mapping. The SVG runs nothing and reaches nothing: a bitmap is written into it as data, and the window
 * shows it as an image. EMF+ records, kept in comments, are passed over: an Office picture keeps EMF's after them.
 *
 * Every read is checked against the record that holds it, so a damaged metafile draws what came before the damage.
 */

/** The most records played, and the most characters of SVG written: past them, the picture is drawn as far as it got. */
const RECORD_LIMIT = 500_000
const SVG_LIMIT = 24 * 1024 * 1024

/** The longest side of a picture whose size nothing gives, in pixels. */
const FALLBACK_SIDE = 480

/** A metafile drawn: its SVG, and its size in pixels at 96 to the inch. */
export interface DrawnMetafile {
  svg: Uint8Array
  width: number
  height: number
}

/** What the file around a metafile says of it, when the metafile does not: the box of its units, its size in pixels. */
export interface MetafileHint {
  bounds?: Box | undefined
  width?: number | undefined
  height?: number | undefined
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

type Matrix = readonly [number, number, number, number, number, number]
type Point = readonly [number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** The matrix that applies `inner`, then `outer`. */
const multiply = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5]
]

const apply = (matrix: Matrix, x: number, y: number): Point => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]

/** A number as SVG takes it: two decimals at most. */
const number = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0')

const MARKS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Text written into SVG: its marks escaped, and the characters XML does not take left out. */
const escaped = (text: string) => {
  let written = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0xfffe || code === 0xffff) continue
    written += MARKS[character] ?? character
  }
  return written
}

/** A colour as Windows keeps it, red in its low byte; one named by its place in a palette is drawn black. */
const colour = (value: number) => {
  if (value >>> 24 === 0x01) return '#000000'
  const hex = (shift: number) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0')
  return `#${hex(0)}${hex(8)}${hex(16)}`
}

/** Bytes as base64, a piece at a time. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

/** Little-endian numbers from a record, each read checked against its end: a read past it gives zero. */
class Reader {
  readonly bytes: Uint8Array
  private readonly data: DataView
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  get length() {
    return this.bytes.length
  }
  has(at: number, size: number) {
    return at >= 0 && at + size <= this.bytes.length
  }
  u8 = (at: number) => (this.has(at, 1) ? this.data.getUint8(at) : 0)
  i16 = (at: number) => (this.has(at, 2) ? this.data.getInt16(at, true) : 0)
  u16 = (at: number) => (this.has(at, 2) ? this.data.getUint16(at, true) : 0)
  i32 = (at: number) => (this.has(at, 4) ? this.data.getInt32(at, true) : 0)
  u32 = (at: number) => (this.has(at, 4) ? this.data.getUint32(at, true) : 0)
  f32 = (at: number) => (this.has(at, 4) ? this.data.getFloat32(at, true) : 0)
  slice = (at: number, size: number) => (size > 0 && this.has(at, size) ? this.bytes.subarray(at, at + size) : undefined)
}

// Bitmaps

/** A picture a bitmap of a metafile becomes: its type, its bytes, its size in pixels, and whether its rows go up. */
interface Bitmap {
  type: string
  bytes: Uint8Array
  width: number
  height: number
  upward: boolean
}

/**
 * A device-independent bitmap as a file the window shows: a `.bmp`, its header before the bitmap's information and
 * pixels, or the JPEG or PNG a bitmap may hold. None for one too large or not a bitmap.
 */
export function dibBitmap(information: Uint8Array, pixels: Uint8Array): Bitmap | undefined {
  const info = new Reader(information)
  const headerSize = info.u32(0)
  if (headerSize < 12 || headerSize > information.length) return undefined
  const core = headerSize === 12
  const width = core ? info.u16(4) : info.i32(4)
  const signedHeight = core ? info.i16(6) : info.i32(8)
  const height = Math.abs(signedHeight)
  const upward = signedHeight > 0
  const compression = core ? 0 : info.u32(16)
  if (width <= 0 || height <= 0 || width > 32_768 || height > 32_768) return undefined
  if (compression === 4) return { type: 'image/jpeg', bytes: pixels, width, height, upward: false }
  if (compression === 5) return { type: 'image/png', bytes: pixels, width, height, upward: false }
  const file = new Uint8Array(14 + information.length + pixels.length)
  const head = new DataView(file.buffer)
  head.setUint16(0, 0x4d42, true)
  head.setUint32(2, file.length, true)
  head.setUint32(10, 14 + information.length, true)
  file.set(information, 14)
  file.set(pixels, 14 + information.length)
  return { type: 'image/bmp', bytes: file, width, height, upward }
}

/** A bitmap whose information and pixels follow one another, as WMF keeps one: split where its pixels start. */
function packedBitmap(bytes: Uint8Array): Bitmap | undefined {
  const info = new Reader(bytes)
  const headerSize = info.u32(0)
  if (headerSize < 12 || headerSize > bytes.length) return undefined
  const core = headerSize === 12
  const bits = core ? info.u16(10) : info.u16(14)
  const compression = core ? 0 : info.u32(16)
  const used = core ? 0 : info.u32(32)
  const colours = used > 0 ? Math.min(used, 256) : bits <= 8 ? 1 << bits : 0
  const masks = headerSize === 40 && (compression === 3 || compression === 6) ? (compression === 3 ? 12 : 16) : 0
  const start = headerSize + masks + colours * (core ? 3 : 4)
  if (start > bytes.length) return undefined
  return dibBitmap(bytes.subarray(0, start), bytes.subarray(start))
}

// What draws

interface Pen {
  style: number
  width: number
  colour: string
  /** A pen of one pixel whatever the mapping, as Windows draws a pen of no width or a cosmetic one. */
  cosmetic: boolean
}

interface Brush {
  style: 'solid' | 'none' | 'hatch' | 'pattern'
  colour: string
  hatch: number
  bitmap?: Bitmap | undefined
}

interface Font {
  height: number
  escapement: number
  weight: number
  italic: boolean
  underline: boolean
  strike: boolean
  charset: number
  face: string
}

type DrawingObject = { kind: 'pen'; pen: Pen } | { kind: 'brush'; brush: Brush } | { kind: 'font'; font: Font } | { kind: 'other' }

const PS_NULL = 5
const BLACK = '#000000'
const WHITE = '#ffffff'
const DEFAULT_PEN: Pen = { style: 0, width: 0, colour: BLACK, cosmetic: true }
const DEFAULT_BRUSH: Brush = { style: 'solid', colour: WHITE, hatch: 0 }
const DEFAULT_FONT: Font = { height: 0, escapement: 0, weight: 400, italic: false, underline: false, strike: false, charset: 0, face: '' }

/** The objects Windows keeps for any picture to select, by their number. */
const STOCK: Record<number, DrawingObject> = {
  0: { kind: 'brush', brush: { style: 'solid', colour: WHITE, hatch: 0 } },
  1: { kind: 'brush', brush: { style: 'solid', colour: '#c0c0c0', hatch: 0 } },
  2: { kind: 'brush', brush: { style: 'solid', colour: '#808080', hatch: 0 } },
  3: { kind: 'brush', brush: { style: 'solid', colour: '#404040', hatch: 0 } },
  4: { kind: 'brush', brush: { style: 'solid', colour: BLACK, hatch: 0 } },
  5: { kind: 'brush', brush: { style: 'none', colour: BLACK, hatch: 0 } },
  6: { kind: 'pen', pen: { style: 0, width: 0, colour: WHITE, cosmetic: true } },
  7: { kind: 'pen', pen: DEFAULT_PEN },
  8: { kind: 'pen', pen: { style: PS_NULL, width: 0, colour: BLACK, cosmetic: true } },
  10: { kind: 'font', font: { ...DEFAULT_FONT, face: 'Courier New' } },
  11: { kind: 'font', font: { ...DEFAULT_FONT, face: 'Courier New' } },
  12: { kind: 'font', font: DEFAULT_FONT },
  13: { kind: 'font', font: DEFAULT_FONT },
  14: { kind: 'font', font: DEFAULT_FONT },
  16: { kind: 'font', font: { ...DEFAULT_FONT, face: 'Courier New' } },
  17: { kind: 'font', font: DEFAULT_FONT },
  18: { kind: 'brush', brush: DEFAULT_BRUSH },
  19: { kind: 'pen', pen: DEFAULT_PEN }
}

/** The code page of a font's 8-bit text, by its character set. */
const CHARSET_LABELS: Record<number, string> = {
  77: 'macintosh',
  128: 'shift_jis',
  129: 'euc-kr',
  134: 'gbk',
  136: 'big5',
  161: 'windows-1253',
  162: 'windows-1254',
  163: 'windows-1258',
  177: 'windows-1255',
  178: 'windows-1256',
  186: 'windows-1257',
  204: 'windows-1251',
  222: 'windows-874',
  238: 'windows-1250'
}

const decoderOf = (charset: number) => {
  try {
    return new TextDecoder(CHARSET_LABELS[charset] ?? 'windows-1252')
  } catch {
    return new TextDecoder('windows-1252')
  }
}

/** How the picture's units map to the device's (`SetMapMode`), and the units per millimetre of the fixed ones. */
const MM_TEXT = 1
const MM_ISOTROPIC = 7
const MM_ANISOTROPIC = 8
const UNITS_PER_MILLIMETRE: Record<number, number> = { 2: 10, 3: 100, 4: 100 / 25.4, 5: 1000 / 25.4, 6: 1440 / 25.4 }

/** Everything a record may change and the next may use, saved and restored whole (`SaveDC`, `RestoreDC`). */
interface State {
  pen: Pen
  brush: Brush
  font: Font
  textColour: string
  background: string
  opaque: boolean
  align: number
  rule: 'evenodd' | 'nonzero'
  clockwise: boolean
  mode: number
  windowOrigin: Point
  windowExtent: Point
  viewportOrigin: Point
  viewportExtent: Point
  world: Matrix
  position: Point
  clip: string | undefined
}

const initialState = (): State => ({
  pen: DEFAULT_PEN,
  brush: DEFAULT_BRUSH,
  font: DEFAULT_FONT,
  textColour: BLACK,
  background: WHITE,
  opaque: true,
  align: 0,
  rule: 'evenodd',
  clockwise: false,
  mode: MM_TEXT,
  windowOrigin: [0, 0],
  windowExtent: [1, 1],
  viewportOrigin: [0, 0],
  viewportExtent: [1, 1],
  world: IDENTITY,
  position: [0, 0],
  clip: undefined
})

/**
 * The drawing a metafile's records make: its state, its objects, the SVG it writes. `toDevice` gives the mapping of a
 * state from the picture's units to the device's; `pixel` is how many of the device's units make a pixel of the
 * picture at its own size, so that a line is never thinner than one.
 */
class Canvas {
  state = initialState()
  private readonly saved: State[] = []
  private readonly parts: string[] = []
  private readonly definitions: string[] = []
  private readonly patterns = new Map<string, string>()
  private written = 0
  private ids = 0
  private group: string | undefined
  private recording: string[] | undefined
  private recorded: string[] | undefined
  private line: string | undefined
  /** The device's box the drawing covers, for a picture whose size nothing gives. */
  extent: Box | undefined
  drawn = false
  full = false

  private readonly toDevice: (state: State) => Matrix
  pixel = 1

  constructor(toDevice: (state: State) => Matrix) {
    this.toDevice = toDevice
  }

  matrix(): Matrix {
    return this.toDevice(this.state)
  }

  /** A point of the picture as SVG writes it, in the device's units. */
  point(x: number, y: number, matrix = this.matrix()): string {
    const [deviceX, deviceY] = apply(matrix, x, y)
    this.stretch(deviceX, deviceY)
    return `${number(deviceX)} ${number(deviceY)}`
  }

  private stretch(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const box = this.extent
    if (!box) this.extent = { left: x, top: y, right: x, bottom: y }
    else {
      box.left = Math.min(box.left, x)
      box.top = Math.min(box.top, y)
      box.right = Math.max(box.right, x)
      box.bottom = Math.max(box.bottom, y)
    }
  }

  save() {
    if (this.saved.length < 256) this.saved.push({ ...this.state })
  }

  /** Back to a state saved: the last for -1, one further back for each less, or the nth from the first when positive. */
  restore(which: number) {
    const index = which < 0 ? this.saved.length + which : which - 1
    const state = this.saved[index]
    if (!state) return
    this.saved.length = index
    this.state = state
  }

  private id(prefix: string) {
    this.ids += 1
    return `${prefix}${this.ids}`
  }

  private write(part: string) {
    if (this.full) return
    if (this.written + part.length > SVG_LIMIT) {
      this.full = true
      return
    }
    this.written += part.length
    this.parts.push(part)
  }

  private define(definition: string) {
    if (this.full) return
    this.written += definition.length
    this.definitions.push(definition)
  }

  /** An element drawn, inside a group clipped as the state says. */
  private element(element: string) {
    this.flushLine()
    this.emit(element)
  }

  private emit(element: string) {
    const clip = this.state.clip
    if (clip !== this.group) {
      if (this.group !== undefined) this.write('</g>')
      if (clip !== undefined) this.write(`<g clip-path="url(#${clip})">`)
      this.group = clip
    }
    this.write(element)
    this.drawn = true
  }

  // Strokes and fills

  private scale(matrix = this.matrix()) {
    return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1
  }

  private stroke(): string {
    const pen = this.state.pen
    if (pen.style === PS_NULL) return ' stroke="none"'
    const width = pen.cosmetic ? 0 : pen.width * this.scale()
    const thin = width < this.pixel
    const dash = pen.style & 0x0f
    const unit = thin ? 1 : width
    const dashes = DASHES[dash]
    const caps = (pen.style >> 8) & 0x0f
    const joins = (pen.style >> 12) & 0x0f
    return (
      ` stroke="${pen.colour}"` +
      (thin ? ' stroke-width="1" vector-effect="non-scaling-stroke"' : ` stroke-width="${number(width)}"`) +
      (dashes ? ` stroke-dasharray="${dashes.map((one) => number(one * unit)).join(' ')}"` : '') +
      ` stroke-linecap="${caps === 1 ? 'square' : caps === 2 ? 'butt' : 'round'}" stroke-linejoin="${joins === 1 ? 'bevel' : joins === 2 ? 'miter' : 'round'}"`
    )
  }

  private fill(brush = this.state.brush): string {
    if (brush.style === 'none') return ' fill="none"'
    if (brush.style === 'solid') return ` fill="${brush.colour}" fill-rule="${this.state.rule}"`
    return ` fill="url(#${this.pattern(brush)})" fill-rule="${this.state.rule}"`
  }

  /** A brush's pattern, defined once: lines of its colour for a hatch, its bitmap tiled for a pattern. */
  private pattern(brush: Brush): string {
    const key = brush.style === 'hatch' ? `hatch ${brush.hatch} ${brush.colour} ${this.state.opaque ? this.state.background : ''}` : `bitmap ${this.ids}`
    const known = this.patterns.get(key)
    if (known) return known
    const id = this.id('p')
    this.patterns.set(key, id)
    if (brush.style === 'pattern' && brush.bitmap) {
      const { width, height, type, bytes } = brush.bitmap
      this.define(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:${type};base64,${base64(bytes)}"/></pattern>`
      )
      return id
    }
    const side = 8 * this.pixel
    const lines = (HATCHES[brush.hatch] ?? HATCHES[0] ?? []).map((line) => line.map((end) => end * side))
    const ground = this.state.opaque ? `<rect width="${number(side)}" height="${number(side)}" fill="${this.state.background}"/>` : ''
    this.define(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${number(side)}" height="${number(side)}">${ground}${lines
        .map(
          ([x1, y1, x2, y2]) =>
            `<line x1="${number(x1 ?? 0)}" y1="${number(y1 ?? 0)}" x2="${number(x2 ?? 0)}" y2="${number(y2 ?? 0)}" stroke="${brush.colour}" stroke-width="${number(this.pixel)}"/>`
        )
        .join('')}</pattern>`
    )
    return id
  }

  // Shapes

  /** A shape: recorded into the path being made, or drawn, filled when it is closed and outlined by the pen. */
  shape(data: string, closed: boolean) {
    if (!data) return
    if (this.recording) {
      this.recording.push(data)
      return
    }
    this.element(`<path d="${data}"${closed ? this.fill() : ' fill="none"'}${this.stroke()}/>`)
  }

  /** A line from where the pen is: lines in a row are one path, until anything else is drawn or changed. */
  lineTo(x: number, y: number) {
    const [fromX, fromY] = this.state.position
    this.state.position = [x, y]
    if (this.recording) {
      if (this.recording.length === 0 || !this.open) this.recording.push(`M${this.point(fromX, fromY)}`)
      this.recording.push(`L${this.point(x, y)}`)
      this.open = true
      return
    }
    this.line = `${this.line ?? `M${this.point(fromX, fromY)}`}L${this.point(x, y)}`
    if (this.line.length > 65_536) this.flushLine()
  }

  moveTo(x: number, y: number) {
    this.state.position = [x, y]
    this.open = false
    if (this.line !== undefined) this.line += `M${this.point(x, y)}`
  }

  /** Whether the path being made has a figure open, which a line goes on from. */
  private open = false

  flushLine() {
    const line = this.line
    this.line = undefined
    if (line?.includes('L')) this.emit(`<path d="${line}" fill="none"${this.stroke()}/>`)
  }

  /** Points as a path: joined by lines, or by curves of three points each after the first, closed or not. */
  polyline(points: readonly Point[], options: { closed?: boolean; curves?: boolean; continued?: boolean } = {}): string {
    const matrix = this.matrix()
    let data = ''
    let start = 0
    if (options.continued) {
      const [x, y] = this.state.position
      data = this.recording && this.open ? '' : `M${this.point(x, y, matrix)}`
    } else {
      const first = points[0]
      if (!first) return ''
      data = `M${this.point(first[0], first[1], matrix)}`
      start = 1
    }
    if (options.curves)
      for (let index = start; index + 2 < points.length; index += 3)
        data += `C${[0, 1, 2].map((offset) => this.point(...(points[index + offset] as Point), matrix)).join(' ')}`
    else for (let index = start; index < points.length; index++) data += `L${this.point(...(points[index] as Point), matrix)}`
    const last = points.at(-1)
    if (last && options.continued) this.state.position = last
    if (this.recording) this.open = !options.closed
    return options.closed ? `${data}Z` : data
  }

  /** An elliptical arc in a box, between the angles given, as curves of a quarter turn at most. */
  arc(box: Box, from: number, sweep: number, join: 'move' | 'line'): string {
    const matrix = this.matrix()
    const centreX = (box.left + box.right) / 2
    const centreY = (box.top + box.bottom) / 2
    const radiusX = Math.abs(box.right - box.left) / 2
    const radiusY = Math.abs(box.bottom - box.top) / 2
    const at = (angle: number): Point => [centreX + radiusX * Math.cos(angle), centreY + radiusY * Math.sin(angle)]
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9))
    const step = sweep / steps
    const handle = (4 / 3) * Math.tan(step / 4)
    let angle = from
    let data = `${join === 'move' ? 'M' : 'L'}${this.point(...at(angle), matrix)}`
    for (let index = 0; index < steps; index++) {
      const next = angle + step
      const [x1, y1] = at(angle)
      const [x2, y2] = at(next)
      const control1: Point = [x1 - handle * radiusX * Math.sin(angle), y1 + handle * radiusY * Math.cos(angle)]
      const control2: Point = [x2 + handle * radiusX * Math.sin(next), y2 - handle * radiusY * Math.cos(next)]
      data += `C${this.point(...control1, matrix)} ${this.point(...control2, matrix)} ${this.point(x2, y2, matrix)}`
      angle = next
    }
    return data
  }

  /**
   * The arc of an ellipse in a box from where a line from its centre through `start` meets it to where one through
   * `end` does, counterclockwise as the picture shows unless the state says clockwise.
   */
  arcBetween(box: Box, start: Point, end: Point, join: 'move' | 'line'): { data: string; last: Point } {
    const centreX = (box.left + box.right) / 2
    const centreY = (box.top + box.bottom) / 2
    const radiusX = Math.abs(box.right - box.left) / 2 || 1
    const radiusY = Math.abs(box.bottom - box.top) / 2 || 1
    const angleOf = ([x, y]: Point) => Math.atan2((y - centreY) / radiusY, (x - centreX) / radiusX)
    const from = angleOf(start)
    const to = angleOf(end)
    let sweep = this.state.clockwise ? to - from : from - to
    while (sweep <= 1e-9) sweep += 2 * Math.PI
    const signed = this.state.clockwise ? sweep : -sweep
    const last: Point = [centreX + radiusX * Math.cos(from + signed), centreY + radiusY * Math.sin(from + signed)]
    return { data: this.arc(box, from, signed, join), last }
  }

  rectangle(box: Box): string {
    const matrix = this.matrix()
    const { left, top, right, bottom } = box
    return `M${this.point(left, top, matrix)}L${this.point(right, top, matrix)}L${this.point(right, bottom, matrix)}L${this.point(left, bottom, matrix)}Z`
  }

  ellipse(box: Box): string {
    return `${this.arc(box, 0, 2 * Math.PI, 'move')}Z`
  }

  roundRectangle(box: Box, width: number, height: number): string {
    const left = Math.min(box.left, box.right)
    const right = Math.max(box.left, box.right)
    const top = Math.min(box.top, box.bottom)
    const bottom = Math.max(box.top, box.bottom)
    const radiusX = Math.min(Math.abs(width) / 2, (right - left) / 2)
    const radiusY = Math.min(Math.abs(height) / 2, (bottom - top) / 2)
    if (radiusX <= 0 || radiusY <= 0) return this.rectangle(box)
    const corner = (centreX: number, centreY: number, from: number) =>
      this.arc({ left: centreX - radiusX, top: centreY - radiusY, right: centreX + radiusX, bottom: centreY + radiusY }, from, Math.PI / 2, 'line')
    const matrix = this.matrix()
    return (
      `M${this.point(left + radiusX, top, matrix)}` +
      `L${this.point(right - radiusX, top, matrix)}${corner(right - radiusX, top + radiusY, -Math.PI / 2)}` +
      `L${this.point(right, bottom - radiusY, matrix)}${corner(right - radiusX, bottom - radiusY, 0)}` +
      `L${this.point(left + radiusX, bottom, matrix)}${corner(left + radiusX, bottom - radiusY, Math.PI / 2)}` +
      `L${this.point(left, top + radiusY, matrix)}${corner(left + radiusX, top + radiusY, Math.PI)}Z`
    )
  }

  // Paths

  beginPath() {
    this.flushLine()
    this.recording = []
    this.recorded = undefined
    this.open = false
  }

  endPath() {
    if (!this.recording) return
    this.recorded = this.recording
    this.recording = undefined
  }

  closeFigure() {
    if (this.recording && this.recording.length > 0) {
      this.recording.push('Z')
      this.open = false
    }
  }

  abortPath() {
    this.recording = undefined
    this.recorded = undefined
  }

  /** The path made, drawn with the brush, the pen or both, then gone. */
  drawPath(fill: boolean, stroke: boolean) {
    const path = this.recorded ?? this.recording
    this.recording = undefined
    this.recorded = undefined
    if (!path || path.length === 0) return
    this.element(`<path d="${path.join('')}"${fill ? this.fill() : ' fill="none"'}${stroke ? this.stroke() : ' stroke="none"'}/>`)
  }

  // Clipping

  /** A clipping of the device's paths, within the clipping before it unless it replaces it. */
  private clipTo(data: string, rule: 'evenodd' | 'nonzero', within: boolean) {
    const id = this.id('c')
    const parent = within && this.state.clip ? ` clip-path="url(#${this.state.clip})"` : ''
    this.define(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"${parent}><path d="${data}" clip-rule="${rule}"/></clipPath>`)
    this.state.clip = id
  }

  intersectClip(box: Box) {
    this.clipTo(this.rectangle(box), 'nonzero', true)
  }

  /** The clipping with a box of the picture taken out of it. */
  excludeClip(box: Box) {
    const all = this.extentBox()
    if (!all) return
    const outside = `M${number(all.left)} ${number(all.top)}H${number(all.right)}V${number(all.bottom)}H${number(all.left)}Z`
    this.clipTo(`${outside}${this.rectangle(box)}`, 'evenodd', true)
  }

  /** Boxes of the device's own units, as a region keeps them: the clipping replaced, cut by them, or gone. */
  regionClip(boxes: readonly Box[], mode: number) {
    if (mode === 5 && boxes.length === 0) {
      this.state.clip = undefined
      return
    }
    const data = boxes.map((box) => `M${number(box.left)} ${number(box.top)}H${number(box.right)}V${number(box.bottom)}H${number(box.left)}Z`).join('')
    if (!data) return
    // Only a region that replaces the clipping or cuts it is followed; one that adds to it leaves the clipping as it is.
    if (mode === 5) this.clipTo(data, 'nonzero', false)
    else if (mode === 1) this.clipTo(data, 'nonzero', true)
  }

  /** The path made, as the clipping. */
  pathClip(mode: number) {
    const path = this.recorded ?? this.recording
    this.recording = undefined
    this.recorded = undefined
    if (!path || path.length === 0) return
    if (mode === 5 || mode === 1) this.clipTo(path.join(''), this.state.rule, mode === 1)
  }

  private frame: Box | undefined
  setFrame(box: Box) {
    this.frame = box
  }
  private extentBox() {
    return this.frame ?? this.extent
  }

  // Text

  /**
   * Text at a point of the picture, placed as the state aligns it, upright on the device whatever the mapping, turned
   * by its font's escapement; each character at the advance the record gives, when it gives them.
   */
  text(x: number, y: number, text: string, options: { advances?: readonly number[] | undefined; opaque?: Box | undefined; clip?: Box | undefined } = {}) {
    if (options.opaque) this.element(`<path d="${this.rectangle(options.opaque)}" fill="${this.state.background}"/>`)
    if (text === '') return
    const state = this.state
    const updating = (state.align & 1) !== 0
    const [atX, atY] = updating ? state.position : [x, y]
    const matrix = this.matrix()
    const font = state.font
    const verticalScale = Math.hypot(matrix[2], matrix[3]) || 1
    const horizontalScale = Math.hypot(matrix[0], matrix[1]) || 1
    // A font's height is its cell's when positive, its characters' when negative; none is the system's, 12 points.
    const em = font.height < 0 ? -font.height * verticalScale : font.height > 0 ? font.height * verticalScale * 0.9 : 16 * this.pixel
    const advances = options.advances?.map((advance) => advance * horizontalScale)
    const total = advances?.reduce((sum, advance) => sum + advance, 0)
    const horizontal = state.align & 6
    const vertical = state.align & 24
    // The baseline, from the top of the cell or its bottom as the alignment says.
    const baseline = vertical === 24 ? 0 : vertical === 8 ? -0.21 * em : 0.89 * em
    const [deviceX, deviceY] = apply(matrix, atX, atY)
    this.stretch(deviceX, deviceY)
    // Text stays upright on the device, turned only by its escapement and a turn of the world's transform.
    const turned = Math.abs(matrix[1]) > 1e-9 || Math.abs(matrix[2]) > 1e-9 ? Math.atan2(matrix[1], matrix[0]) * (180 / Math.PI) : 0
    const angle = -font.escapement / 10 + turned
    let start = 0
    let anchor = 'start'
    let positions = ''
    const characters = [...text].length
    if (advances && total !== undefined && advances.length >= characters) {
      start = horizontal === 2 ? -total : horizontal === 6 ? -total / 2 : 0
      let place = start
      const places: string[] = []
      for (let index = 0; index < characters; index++) {
        places.push(number(place))
        place += advances[index] ?? 0
      }
      positions = ` x="${places.join(' ')}"`
    } else {
      anchor = horizontal === 2 ? 'end' : horizontal === 6 ? 'middle' : 'start'
      positions = ' x="0"'
    }
    const decoration = [font.underline ? 'underline' : '', font.strike ? 'line-through' : ''].filter(Boolean).join(' ')
    const family = [
      font.face ? `'${escaped(font.face).replaceAll("'", '')}'` : '',
      /courier|mono|consol/i.test(font.face)
        ? 'monospace'
        : /roman|times|serif|georgia|garamond/i.test(font.face) && !/sans/i.test(font.face)
          ? 'serif'
          : 'sans-serif'
    ]
      .filter(Boolean)
      .join(', ')
    // The text's own box clips it from around it: a clipping on the text itself would be in its turned and moved units.
    const clip = options.clip ? this.clipFor(options.clip) : ''
    this.element(
      `${clip ? `<g${clip}>` : ''}<text transform="translate(${number(deviceX)} ${number(deviceY)})${angle ? ` rotate(${number(angle)})` : ''}"${positions} y="${number(baseline)}" font-family="${family}" font-size="${number(em)}"${font.weight >= 600 ? ' font-weight="bold"' : ''}${font.italic ? ' font-style="italic"' : ''}${decoration ? ` text-decoration="${decoration}"` : ''}${anchor === 'start' ? '' : ` text-anchor="${anchor}"`} fill="${state.textColour}" xml:space="preserve">${escaped(text)}</text>${clip ? '</g>' : ''}`
    )
    if (updating && total !== undefined) state.position = [atX + (total / horizontalScale) * (horizontal === 2 ? -1 : 1), atY]
  }

  private clipFor(box: Box): string {
    const id = this.id('c')
    this.define(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${this.rectangle(box)}"/></clipPath>`)
    return ` clip-path="url(#${id})"`
  }

  // Bitmaps

  /**
   * A bitmap in a box of the picture, from a box of its own pixels, as clear as `opacity` says. A device-independent
   * bitmap's own box counts its rows from the bottom when they go up (`fromBottom`), as Windows counts them.
   */
  bitmap(destination: Box, picture: Bitmap, source?: Box, options: { opacity?: number; fromBottom?: boolean } = {}) {
    const { opacity = 1, fromBottom = false } = options
    const matrix = this.matrix()
    const width = destination.right - destination.left
    const height = destination.bottom - destination.top
    if (width === 0 || height === 0) return
    let from = source && source.right > source.left && source.bottom > source.top ? source : { left: 0, top: 0, right: picture.width, bottom: picture.height }
    if (source && fromBottom && picture.upward) from = { ...from, top: picture.height - from.bottom, bottom: picture.height - from.top }
    this.point(destination.left, destination.top, matrix)
    this.point(destination.right, destination.bottom, matrix)
    const flip = `${width < 0 || height < 0 ? ` scale(${width < 0 ? -1 : 1} ${height < 0 ? -1 : 1})` : ''}`
    this.element(
      `<g transform="matrix(${matrix.map(number).join(' ')}) translate(${number(destination.left)} ${number(destination.top)})${flip}"${opacity < 1 ? ` opacity="${number(opacity)}"` : ''}>` +
        `<svg width="${number(Math.abs(width))}" height="${number(Math.abs(height))}" viewBox="${number(from.left)} ${number(from.top)} ${number(from.right - from.left)} ${number(from.bottom - from.top)}" preserveAspectRatio="none" overflow="hidden">` +
        `<image width="${picture.width}" height="${picture.height}" preserveAspectRatio="none" href="data:${picture.type};base64,${base64(picture.bytes)}"/></svg></g>`
    )
  }

  /** A box of the picture filled with a brush, or with black or white, as a raster operation without a bitmap says. */
  fillBox(box: Box, operation: number) {
    const brush: Brush | undefined =
      operation === 0x00000042
        ? { style: 'solid', colour: BLACK, hatch: 0 }
        : operation === 0x00ff0062
          ? { style: 'solid', colour: WHITE, hatch: 0 }
          : operation === 0x00f00021
            ? this.state.brush
            : undefined
    if (brush) this.element(`<path d="${this.rectangle(box)}"${this.fill(brush)} stroke="none"/>`)
  }

  /** Colours that shade into one another across a box, along it or down it. */
  gradient(box: Box, from: string, to: string, vertical: boolean) {
    const id = this.id('g')
    const [x1, y1] = apply(this.matrix(), box.left, box.top)
    const [x2, y2] = apply(this.matrix(), vertical ? box.left : box.right, vertical ? box.bottom : box.top)
    this.define(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${number(x1)}" y1="${number(y1)}" x2="${number(x2)}" y2="${number(y2)}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
    )
    this.element(`<path d="${this.rectangle(box)}" fill="url(#${id})" stroke="none"/>`)
  }

  /** A shape filled with one colour and no outline. */
  solid(data: string, fill: string) {
    if (data) this.element(`<path d="${data}" fill="${fill}" stroke="none"/>`)
  }

  /** The SVG of what was drawn, in a box of the device's units, at a size in pixels. */
  svg(box: Box, width: number, height: number): Uint8Array {
    this.flushLine()
    if (this.group !== undefined) this.write('</g>')
    this.group = undefined
    const viewBox = `${number(box.left)} ${number(box.top)} ${number(box.right - box.left)} ${number(box.bottom - box.top)}`
    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="${viewBox}" preserveAspectRatio="none" overflow="hidden">`
    const definitions = this.definitions.length > 0 ? `<defs>${this.definitions.join('')}</defs>` : ''
    return new TextEncoder().encode(`${head}${definitions}${this.parts.join('')}</svg>`)
  }
}

/** A box from four numbers in the order a record keeps them. */
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

/** The dashes of each style of pen, in widths of the pen; the hatches of each style of brush, in sides of its tile. */
const DASHES: Record<number, number[]> = { 1: [6, 2], 2: [1.5, 1.5], 3: [6, 2, 1.5, 2], 4: [6, 2, 1.5, 2, 1.5, 2] }
const HATCHES: Record<number, number[][]> = {
  0: [[0, 0.5, 1, 0.5]],
  1: [[0.5, 0, 0.5, 1]],
  2: [[0, 0, 1, 1]],
  3: [[0, 1, 1, 0]],
  4: [
    [0, 0.5, 1, 0.5],
    [0.5, 0, 0.5, 1]
  ],
  5: [
    [0, 0, 1, 1],
    [0, 1, 1, 0]
  ]
}

const validBox = (found: Box | undefined): found is Box =>
  found !== undefined && [found.left, found.top, found.right, found.bottom].every(Number.isFinite) && found.right > found.left && found.bottom > found.top

/** The size in pixels of a picture whose size nothing says: its box, made to fit a fallback side when larger. */
function fallbackSize(found: Box): { width: number; height: number } {
  const width = found.right - found.left
  const height = found.bottom - found.top
  const shrink = Math.min(1, FALLBACK_SIDE / Math.max(width, height))
  return { width: Math.max(1, width * shrink), height: Math.max(1, height * shrink) }
}

/** The size a metafile drawn is shown at: the size given, its other side in proportion when one is, else its own. */
export function shownSize(given: { width?: number | undefined; height?: number | undefined }, drawn: DrawnMetafile): { width: number; height: number } {
  const ratio = drawn.height / drawn.width
  const width = given.width ?? (given.height !== undefined ? given.height / ratio : drawn.width)
  const height = given.height ?? (given.width !== undefined ? given.width * ratio : drawn.height)
  return { width: Math.round(width), height: Math.round(height) }
}

/** The kind of a metafile by its first bytes: EMF, WMF behind its placeable header or without it, or none. */
export function metafileKind(bytes: Uint8Array): 'emf' | 'wmf' | undefined {
  const head = new Reader(bytes)
  if (head.u32(0) === 1 && head.u32(40) === 0x464d4520) return 'emf'
  if (head.u32(0) === 0x9ac6cdd7) return 'wmf'
  if ((head.u16(0) === 1 || head.u16(0) === 2) && head.u16(2) === 9 && (head.u16(4) === 0x0300 || head.u16(4) === 0x0100)) return 'wmf'
  return undefined
}

/** A metafile drawn as SVG: none for one that is not a metafile, or draws nothing. */
export function drawMetafile(bytes: Uint8Array, hint: MetafileHint = {}): DrawnMetafile | undefined {
  try {
    const kind = metafileKind(bytes)
    return kind === 'emf' ? drawEnhanced(bytes, hint) : kind === 'wmf' ? drawWindows(bytes, hint) : undefined
  } catch {
    return undefined
  }
}

// WMF

/**
 * A WMF: its placeable header first when it has one, giving its box and units to the inch, then a header of its own,
 * then records of 16-bit words, each its size in words, its function, then its parameters, most of them backwards.
 * Its units map to the box: the window it sets is drawn in the box, as a program playing it does.
 */
function drawWindows(bytes: Uint8Array, hint: MetafileHint): DrawnMetafile | undefined {
  const file = new Reader(bytes)
  let at = 0
  let frame: Box | undefined
  let size: { width: number; height: number } | undefined
  if (file.u32(0) === 0x9ac6cdd7) {
    frame = box(file.i16(6), file.i16(8), file.i16(10), file.i16(12))
    if (frame.right < frame.left) [frame.left, frame.right] = [frame.right, frame.left]
    if (frame.bottom < frame.top) [frame.top, frame.bottom] = [frame.bottom, frame.top]
    const inch = file.u16(14) || 1440
    size = { width: ((frame.right - frame.left) / inch) * 96, height: ((frame.bottom - frame.top) / inch) * 96 }
    at = 22
  } else if (validBox(hint.bounds)) frame = { ...hint.bounds }
  if (!validBox(frame)) frame = undefined
  const headerWords = file.u16(at + 2)
  if (headerWords < 9) return undefined
  at += headerWords * 2

  let fixed = frame
  let shown: { width: number; height: number } | undefined
  const canvas = new Canvas((state) => {
    if (!fixed) return IDENTITY
    const [originX, originY] = state.windowOrigin
    const [extentX, extentY] = state.windowExtent
    const scaleX = (fixed.right - fixed.left) / (extentX || 1)
    const scaleY = (fixed.bottom - fixed.top) / (extentY || 1)
    return [scaleX, 0, 0, scaleY, fixed.left - originX * scaleX, fixed.top - originY * scaleY]
  })
  // Once its box is known, so is its size, and how many of its units make a pixel.
  const settle = (found: Box) => {
    fixed = found
    shown = hint.width && hint.height ? { width: hint.width, height: hint.height } : (size ?? fallbackSize(found))
    canvas.pixel = (found.right - found.left) / shown.width
    canvas.setFrame(found)
  }
  if (frame) {
    canvas.state.windowOrigin = [frame.left, frame.top]
    canvas.state.windowExtent = [frame.right - frame.left, frame.bottom - frame.top]
    settle(frame)
  }
  const objects: (DrawingObject | undefined)[] = []
  const create = (object: DrawingObject) => {
    const free = objects.indexOf(undefined)
    if (free >= 0) objects[free] = object
    else objects.push(object)
  }
  let originSet = false

  for (let count = 0; at + 6 <= bytes.length && count < RECORD_LIMIT && !canvas.full; count++) {
    const words = file.u32(at)
    const kind = file.u16(at + 4)
    if (words < 3 || at + words * 2 > bytes.length) break
    const record = new Reader(bytes.subarray(at + 6, at + words * 2))
    at += words * 2
    if (kind === 0x0000) break
    const word = (index: number) => record.i16(index * 2)
    const unsigned = (index: number) => record.u16(index * 2)
    if (kind !== 0x0213 && kind !== 0x0214) canvas.flushLine()
    switch (kind) {
      case 0x020b:
        canvas.state.windowOrigin = [word(1), word(0)]
        originSet = true
        break
      case 0x020c:
        canvas.state.windowExtent = [word(1), word(0)]
        // A metafile with no box of its own is drawn in its first window, turned over when the window is.
        if (!fixed && word(1) !== 0 && word(0) !== 0) {
          const [left, top] = originSet ? canvas.state.windowOrigin : [0, 0]
          settle(box(Math.min(left, left + word(1)), Math.min(top, top + word(0)), Math.max(left, left + word(1)), Math.max(top, top + word(0))))
        }
        break
      case 0x020f: {
        const [x, y] = canvas.state.windowOrigin
        canvas.state.windowOrigin = [x + word(1), y + word(0)]
        break
      }
      case 0x0410: {
        const [x, y] = canvas.state.windowExtent
        canvas.state.windowExtent = [(x * word(3)) / (word(2) || 1), (y * word(1)) / (word(0) || 1)]
        break
      }
      case 0x001e:
        canvas.save()
        break
      case 0x0127:
        canvas.restore(word(0))
        break
      case 0x0201:
        canvas.state.background = colour(record.u32(0))
        break
      case 0x0209:
        canvas.state.textColour = colour(record.u32(0))
        break
      case 0x0102:
        canvas.state.opaque = unsigned(0) === 2
        break
      case 0x012e:
        canvas.state.align = unsigned(0)
        break
      case 0x0106:
        canvas.state.rule = unsigned(0) === 2 ? 'nonzero' : 'evenodd'
        break
      case 0x0103:
        canvas.state.mode = unsigned(0)
        break
      case 0x02fa: {
        const style = unsigned(0)
        const width = word(1)
        create({ kind: 'pen', pen: { style, width, colour: colour(record.u32(6)), cosmetic: width <= 1 } })
        break
      }
      case 0x02fc: {
        const style = unsigned(0)
        create({
          kind: 'brush',
          brush: { style: style === 1 ? 'none' : style === 2 ? 'hatch' : 'solid', colour: colour(record.u32(2)), hatch: unsigned(3) }
        })
        break
      }
      case 0x0142: {
        const bitmap = packedBitmap(record.bytes.subarray(4))
        create({ kind: 'brush', brush: bitmap ? { style: 'pattern', colour: BLACK, hatch: 0, bitmap } : { style: 'solid', colour: '#808080', hatch: 0 } })
        break
      }
      case 0x01f9:
        create({ kind: 'brush', brush: { style: 'solid', colour: '#808080', hatch: 0 } })
        break
      case 0x02fb: {
        const face = record.bytes.subarray(18, 50)
        const end = face.indexOf(0)
        const charset = record.u8(13)
        create({
          kind: 'font',
          font: {
            height: word(0),
            escapement: word(2),
            weight: word(4),
            italic: record.u8(10) !== 0,
            underline: record.u8(11) !== 0,
            strike: record.u8(12) !== 0,
            charset,
            face: new TextDecoder('windows-1252').decode(end >= 0 ? face.subarray(0, end) : face)
          }
        })
        break
      }
      case 0x00f7:
      case 0x06ff:
        create({ kind: 'other' })
        break
      case 0x012d: {
        const object = objects[unsigned(0)]
        if (object?.kind === 'pen') canvas.state.pen = object.pen
        else if (object?.kind === 'brush') canvas.state.brush = object.brush
        else if (object?.kind === 'font') canvas.state.font = object.font
        break
      }
      case 0x01f0:
        objects[unsigned(0)] = undefined
        break
      case 0x0214:
        canvas.moveTo(word(1), word(0))
        break
      case 0x0213:
        canvas.lineTo(word(1), word(0))
        break
      case 0x041b:
        canvas.shape(canvas.rectangle(box(word(3), word(2), word(1), word(0))), true)
        break
      case 0x061c:
        canvas.shape(canvas.roundRectangle(box(word(5), word(4), word(3), word(2)), word(1), word(0)), true)
        break
      case 0x0418:
        canvas.shape(canvas.ellipse(box(word(3), word(2), word(1), word(0))), true)
        break
      case 0x0817:
      case 0x081a:
      case 0x0830: {
        const area = box(word(7), word(6), word(5), word(4))
        const centre: Point = [(area.left + area.right) / 2, (area.top + area.bottom) / 2]
        const { data } = canvas.arcBetween(area, [word(3), word(2)], [word(1), word(0)], kind === 0x081a ? 'line' : 'move')
        if (kind === 0x0817) canvas.shape(data, false)
        else canvas.shape(kind === 0x081a ? `M${canvas.point(...centre)}${data}Z` : `${data}Z`, true)
        break
      }
      case 0x0324:
      case 0x0325: {
        // A count is followed only as far as the record holds points.
        const points: Point[] = []
        const count = Math.min(unsigned(0), Math.floor((record.length - 2) / 4))
        for (let index = 0; index < count; index++) points.push([word(1 + index * 2), word(2 + index * 2)])
        canvas.shape(canvas.polyline(points, { closed: kind === 0x0324 }), kind === 0x0324)
        break
      }
      case 0x0538: {
        const words = record.length / 2
        const polygons = Math.min(unsigned(0), words - 1)
        let place = 1 + polygons
        let data = ''
        for (let polygon = 0; polygon < polygons && place + 1 < words; polygon++) {
          const points: Point[] = []
          for (let index = 0; index < unsigned(1 + polygon) && place + 1 < words; index++, place += 2) points.push([word(place), word(place + 1)])
          data += canvas.polyline(points, { closed: true })
        }
        canvas.shape(data, true)
        break
      }
      case 0x0416:
        canvas.intersectClip(box(word(3), word(2), word(1), word(0)))
        break
      case 0x0415:
        canvas.excludeClip(box(word(3), word(2), word(1), word(0)))
        break
      case 0x012c:
        canvas.state.clip = undefined
        break
      case 0x0521: {
        const length = unsigned(0)
        const text = decoderOf(canvas.state.font.charset).decode(record.bytes.subarray(2, 2 + length))
        const place = 1 + Math.ceil(length / 2)
        canvas.text(word(place + 1), word(place), text)
        break
      }
      case 0x0a32: {
        const length = unsigned(2)
        const options = unsigned(3)
        const boxed = (options & 0x0006) !== 0
        const area = boxed ? box(word(4), word(5), word(6), word(7)) : undefined
        const start = (boxed ? 16 : 8) / 2
        const text = decoderOf(canvas.state.font.charset).decode(record.bytes.subarray(start * 2, start * 2 + length))
        const advancesAt = start + Math.ceil(length / 2)
        const advances = record.has(advancesAt * 2, length * 2) ? Array.from({ length }, (_, index) => word(advancesAt + index)) : undefined
        canvas.text(word(1), word(0), text, { advances, opaque: options & 0x0002 ? area : undefined, clip: options & 0x0004 ? area : undefined })
        break
      }
      case 0x0f43: {
        const bitmap = packedBitmap(record.bytes.subarray(22))
        if (bitmap && record.u32(0) !== 0x008800c6)
          canvas.bitmap(box(word(10), word(9), word(10) + word(8), word(9) + word(7)), bitmap, box(word(6), word(5), word(6) + word(4), word(5) + word(3)), {
            fromBottom: true
          })
        break
      }
      case 0x0b41:
      case 0x0940: {
        const operation = record.u32(0)
        const stretched = kind === 0x0b41
        const fields = stretched ? 8 : 6
        const bare = words === 3 + 2 + 1 + fields
        const first = bare ? 3 : 2
        const value = (index: number) => word(first + index)
        const destination = stretched
          ? box(value(7), value(6), value(7) + value(5), value(6) + value(4))
          : box(value(5), value(4), value(5) + value(3), value(4) + value(2))
        if (bare) canvas.fillBox(destination, operation)
        else {
          const bitmap = packedBitmap(record.bytes.subarray((first + fields) * 2))
          const source = stretched
            ? box(value(3), value(2), value(3) + value(1), value(2) + value(0))
            : box(value(1), value(0), value(1) + value(3), value(0) + value(2))
          if (bitmap && operation !== 0x008800c6) canvas.bitmap(destination, bitmap, source)
        }
        break
      }
      case 0x061d:
        canvas.fillBox(box(word(5), word(4), word(5) + word(3), word(4) + word(2)), record.u32(0))
        break
    }
  }
  canvas.flushLine()
  const drawnIn = fixed ?? canvas.extent
  if (!canvas.drawn || !validBox(drawnIn)) return undefined
  const sized = shown ?? (hint.width && hint.height ? { width: hint.width, height: hint.height } : fallbackSize(drawnIn))
  return { svg: canvas.svg(drawnIn, sized.width, sized.height), width: sized.width, height: sized.height }
}

// EMF

/**
 * An EMF: a header giving the box it draws in, in hundredths of a millimetre, and the size of the device it was
 * recorded on, then records of 32-bit values, each its type and its size. Its units map to the device's through the
 * world's transform, then its window and viewport; the SVG is in the device's pixels, its box the header's.
 */
function drawEnhanced(bytes: Uint8Array, hint: MetafileHint): DrawnMetafile | undefined {
  const file = new Reader(bytes)
  const headerSize = file.u32(4)
  const bounds = box(file.i32(8), file.i32(12), file.i32(16) + 1, file.i32(20) + 1)
  const frame = box(file.i32(24), file.i32(28), file.i32(32), file.i32(36))
  const deviceWidth = file.i32(72)
  const millimetres = file.i32(80)
  const micrometres = headerSize >= 108 ? file.i32(100) : 0
  const pixelsPerMillimetre =
    micrometres > 0 && deviceWidth > 0 ? (deviceWidth * 1000) / micrometres : deviceWidth > 0 && millimetres > 0 ? deviceWidth / millimetres : 96 / 25.4
  const frameBox = validBox(frame)
    ? box(
        (frame.left * pixelsPerMillimetre) / 100,
        (frame.top * pixelsPerMillimetre) / 100,
        (frame.right * pixelsPerMillimetre) / 100,
        (frame.bottom * pixelsPerMillimetre) / 100
      )
    : validBox(bounds)
      ? bounds
      : undefined

  const pageToDevice = (state: State): Matrix => {
    const [windowX, windowY] = state.windowOrigin
    const [viewportX, viewportY] = state.viewportOrigin
    let scaleX = 1
    let scaleY = 1
    if (state.mode === MM_ANISOTROPIC || state.mode === MM_ISOTROPIC) {
      scaleX = state.viewportExtent[0] / (state.windowExtent[0] || 1)
      scaleY = state.viewportExtent[1] / (state.windowExtent[1] || 1)
      if (state.mode === MM_ISOTROPIC) {
        const smallest = Math.min(Math.abs(scaleX), Math.abs(scaleY))
        scaleX = Math.sign(scaleX) * smallest
        scaleY = Math.sign(scaleY) * smallest
      }
    } else if (state.mode !== MM_TEXT) {
      const units = UNITS_PER_MILLIMETRE[state.mode] ?? 1
      scaleX = pixelsPerMillimetre / units
      scaleY = -scaleX
    }
    return [scaleX, 0, 0, scaleY, viewportX - windowX * scaleX, viewportY - windowY * scaleY]
  }
  const canvas = new Canvas((state) => multiply(pageToDevice(state), state.world))
  const ownWidth = validBox(frame) ? ((frame.right - frame.left) / 2540) * 96 : undefined
  const ownHeight = validBox(frame) ? ((frame.bottom - frame.top) / 2540) * 96 : undefined
  const sizeOf = (found: Box) =>
    hint.width && hint.height
      ? { width: hint.width, height: hint.height }
      : ownWidth && ownHeight
        ? { width: ownWidth, height: ownHeight }
        : fallbackSize(found)
  if (frameBox) {
    canvas.setFrame(frameBox)
    canvas.pixel = (frameBox.right - frameBox.left) / sizeOf(frameBox).width
  }
  const objects = new Map<number, DrawingObject>()

  for (let at = 0, count = 0; at + 8 <= bytes.length && count < RECORD_LIMIT && !canvas.full; count++) {
    const type = file.u32(at)
    const size = file.u32(at + 4)
    if (size < 8 || size % 4 !== 0 || at + size > bytes.length) break
    const record = new Reader(bytes.subarray(at, at + size))
    at += size
    if (type === 14) break
    if (type !== 54 && type !== 27) canvas.flushLine()
    const point = (offset: number): Point => [record.i32(offset), record.i32(offset + 4)]
    const rectangle = (offset: number) => box(record.i32(offset), record.i32(offset + 4), record.i32(offset + 8), record.i32(offset + 12))
    const points = (offset: number, count: number, short: boolean): Point[] => {
      const found: Point[] = []
      const step = short ? 4 : 8
      const fits = Math.min(count, Math.floor((record.length - offset) / step))
      for (let index = 0; index < fits; index++) {
        const place = offset + index * step
        found.push(short ? [record.i16(place), record.i16(place + 2)] : [record.i32(place), record.i32(place + 4)])
      }
      return found
    }
    const bitmapAt = (information: number, informationSize: number, pixels: number, pixelsSize: number) => {
      const info = record.slice(record.u32(information), record.u32(informationSize))
      const bits = record.slice(record.u32(pixels), record.u32(pixelsSize))
      return info && bits ? dibBitmap(info, bits) : undefined
    }
    const state = canvas.state
    switch (type) {
      case 9:
        state.windowExtent = point(8)
        break
      case 10:
        state.windowOrigin = point(8)
        break
      case 11:
        state.viewportExtent = point(8)
        break
      case 12:
        state.viewportOrigin = point(8)
        break
      case 17:
        state.mode = record.u32(8)
        break
      case 18:
        state.opaque = record.u32(8) === 2
        break
      case 19:
        state.rule = record.u32(8) === 2 ? 'nonzero' : 'evenodd'
        break
      case 22:
        state.align = record.u32(8)
        break
      case 24:
        state.textColour = colour(record.u32(8))
        break
      case 25:
        state.background = colour(record.u32(8))
        break
      case 27:
        canvas.moveTo(...point(8))
        break
      case 28:
        state.clip = undefined
        break
      case 29:
        canvas.excludeClip(rectangle(8))
        break
      case 30:
        canvas.intersectClip(rectangle(8))
        break
      case 31:
      case 32: {
        const target = type === 31 ? 'viewportExtent' : 'windowExtent'
        const [x, y] = state[target]
        state[target] = [(x * record.i32(8)) / (record.i32(12) || 1), (y * record.i32(16)) / (record.i32(20) || 1)]
        break
      }
      case 33:
        canvas.save()
        break
      case 34:
        canvas.restore(record.i32(8))
        break
      case 35:
      case 36: {
        const given: Matrix = [record.f32(8), record.f32(12), record.f32(16), record.f32(20), record.f32(24), record.f32(28)]
        if (!given.every(Number.isFinite)) break
        const mode = type === 35 ? 4 : record.u32(32)
        state.world = mode === 1 ? IDENTITY : mode === 2 ? multiply(state.world, given) : mode === 3 ? multiply(given, state.world) : given
        break
      }
      case 37: {
        const index = record.u32(8)
        const object = index & 0x80000000 ? STOCK[index & 0x7fffffff] : objects.get(index)
        if (object?.kind === 'pen') state.pen = object.pen
        else if (object?.kind === 'brush') state.brush = object.brush
        else if (object?.kind === 'font') state.font = object.font
        break
      }
      case 38: {
        const style = record.u32(12)
        const width = record.i32(16)
        objects.set(record.u32(8), { kind: 'pen', pen: { style, width, colour: colour(record.u32(24)), cosmetic: width <= 1 } })
        break
      }
      case 95: {
        const style = record.u32(28)
        const brushStyle = record.u32(36)
        objects.set(record.u32(8), {
          kind: 'pen',
          pen: {
            style: brushStyle === 1 ? PS_NULL : style & 0xffff,
            width: record.u32(32),
            colour: colour(record.u32(40)),
            cosmetic: (style & 0x00010000) === 0
          }
        })
        break
      }
      case 39: {
        const style = record.u32(12)
        objects.set(record.u32(8), {
          kind: 'brush',
          brush: { style: style === 1 ? 'none' : style === 2 ? 'hatch' : 'solid', colour: colour(record.u32(16)), hatch: record.u32(20) }
        })
        break
      }
      case 93:
      case 94: {
        const bitmap = bitmapAt(16, 20, 24, 28)
        objects.set(record.u32(8), {
          kind: 'brush',
          brush: bitmap ? { style: 'pattern', colour: BLACK, hatch: 0, bitmap } : { style: 'solid', colour: '#808080', hatch: 0 }
        })
        break
      }
      case 82: {
        const face = new TextDecoder('utf-16le').decode(record.bytes.subarray(40, 104)).replace(/\0.*$/s, '')
        objects.set(record.u32(8), {
          kind: 'font',
          font: {
            height: record.i32(12),
            escapement: record.i32(20),
            weight: record.i32(28),
            italic: record.u8(32) !== 0,
            underline: record.u8(33) !== 0,
            strike: record.u8(34) !== 0,
            charset: record.u8(35),
            face
          }
        })
        break
      }
      case 40:
        objects.delete(record.u32(8))
        break
      case 48:
      case 49:
        if (type === 49) objects.set(record.u32(8), { kind: 'other' })
        break
      case 54:
        canvas.lineTo(...point(8))
        break
      case 42:
        canvas.shape(canvas.ellipse(rectangle(8)), true)
        break
      case 43:
        canvas.shape(canvas.rectangle(rectangle(8)), true)
        break
      case 44:
        canvas.shape(canvas.roundRectangle(rectangle(8), record.i32(24), record.i32(28)), true)
        break
      case 45:
      case 46:
      case 47:
      case 55: {
        const area = rectangle(8)
        const centre: Point = [(area.left + area.right) / 2, (area.top + area.bottom) / 2]
        const { data, last } = canvas.arcBetween(area, point(24), point(32), type === 47 || type === 55 ? 'line' : 'move')
        if (type === 45) canvas.shape(data, false)
        else if (type === 55) {
          const [x, y] = state.position
          canvas.shape(`M${canvas.point(x, y)}${data}`, false)
          state.position = last
        } else canvas.shape(type === 47 ? `M${canvas.point(...centre)}${data}Z` : `${data}Z`, true)
        break
      }
      case 57:
        state.clockwise = record.u32(8) === 2
        break
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 85:
      case 86:
      case 87:
      case 88:
      case 89: {
        const short = type >= 85
        const base = short ? type - 83 : type
        const found = points(28, record.u32(24), short)
        const closed = base === 3
        canvas.shape(canvas.polyline(found, { closed, curves: base === 2 || base === 5, continued: base === 5 || base === 6 }), closed)
        break
      }
      case 7:
      case 8:
      case 90:
      case 91: {
        const short = type >= 90
        const closed = type === 8 || type === 91
        const polygons = Math.min(record.u32(24), Math.floor((record.length - 32) / 4))
        let place = 32 + polygons * 4
        let data = ''
        for (let polygon = 0; polygon < polygons; polygon++) {
          const count = record.u32(32 + polygon * 4)
          const found = points(place, count, short)
          place += count * (short ? 4 : 8)
          data += canvas.polyline(found, { closed })
        }
        canvas.shape(data, closed)
        break
      }
      case 56:
      case 92: {
        const short = type === 92
        const count = record.u32(24)
        const found = points(28, count, short)
        const kinds = 28 + count * (short ? 4 : 8)
        let data = ''
        for (let index = 0; index < found.length; index++) {
          const kind = record.u8(kinds + index)
          const [x, y] = found[index] as Point
          if ((kind & 0x06) === 0x06) data += `M${canvas.point(x, y)}`
          else if ((kind & 0x06) === 0x04 && index + 2 < found.length) {
            data += `C${[0, 1, 2].map((offset) => canvas.point(...(found[index + offset] as Point))).join(' ')}`
            index += 2
          } else data += `L${canvas.point(x, y)}`
          if (kind & 0x01) data += 'Z'
        }
        canvas.shape(data, false)
        break
      }
      case 59:
        canvas.beginPath()
        break
      case 60:
        canvas.endPath()
        break
      case 61:
        canvas.closeFigure()
        break
      case 62:
      case 63:
      case 64:
        canvas.drawPath(type !== 64, type !== 62)
        break
      case 67:
        canvas.pathClip(record.u32(8))
        break
      case 68:
        canvas.abortPath()
        break
      case 71: {
        // A region filled with a brush: its boxes, in the device's units.
        const brush = objects.get(record.u32(28))
        const found = regionBoxes(record, 32)
        if (brush?.kind === 'brush' && brush.brush.style === 'solid') canvas.solid(found.map(regionPath).join(''), brush.brush.colour)
        break
      }
      case 74:
        if (state.brush.style === 'solid') canvas.solid(regionBoxes(record, 28).map(regionPath).join(''), state.brush.colour)
        break
      case 75:
        canvas.regionClip(record.u32(8) > 0 ? regionBoxes(record, 16) : [], record.u32(12))
        break
      case 76:
      case 77:
      case 114:
      case 116: {
        const destination = box(record.i32(24), record.i32(28), record.i32(24) + record.i32(32), record.i32(28) + record.i32(36))
        const operation = record.u32(40)
        if (record.u32(88) === 0) {
          if (type === 76 || type === 77) canvas.fillBox(destination, operation)
          break
        }
        const bitmap = bitmapAt(84, 88, 92, 96)
        if (!bitmap) break
        const stretched = type !== 76
        const source = box(
          record.i32(44),
          record.i32(48),
          record.i32(44) + (stretched ? record.i32(100) : record.i32(32)),
          record.i32(48) + (stretched ? record.i32(104) : record.i32(36))
        )
        if (type === 114) canvas.bitmap(destination, bitmap, source, { opacity: ((operation >>> 16) & 0xff) / 255 })
        else if (operation !== 0x008800c6) canvas.bitmap(destination, bitmap, source)
        break
      }
      case 80: {
        const bitmap = bitmapAt(48, 52, 56, 60)
        if (bitmap)
          canvas.bitmap(
            box(record.i32(24), record.i32(28), record.i32(24) + record.i32(40), record.i32(28) + record.i32(44)),
            bitmap,
            box(record.i32(32), record.i32(36), record.i32(32) + record.i32(40), record.i32(36) + record.i32(44)),
            { fromBottom: true }
          )
        break
      }
      case 81: {
        const bitmap = bitmapAt(48, 52, 56, 60)
        const operation = record.u32(68)
        if (bitmap && operation !== 0x008800c6)
          canvas.bitmap(
            box(record.i32(24), record.i32(28), record.i32(24) + record.i32(72), record.i32(28) + record.i32(76)),
            bitmap,
            box(record.i32(32), record.i32(36), record.i32(32) + record.i32(40), record.i32(36) + record.i32(44)),
            { fromBottom: true }
          )
        break
      }
      case 83:
      case 84: {
        const wide = type === 84
        const length = Math.min(record.u32(44), 32_768)
        const options = record.u32(52)
        const text = record.slice(record.u32(48), length * (wide ? 2 : 1))
        if (!text) break
        const words = wide ? new TextDecoder('utf-16le').decode(text) : decoderOf(state.font.charset).decode(text)
        const advancesAt = record.u32(72)
        // Advances given in pairs, across then down, are read across.
        const pairs = (options & 0x2000) !== 0
        const advances =
          advancesAt > 0 && record.has(advancesAt, length * 4 * (pairs ? 2 : 1))
            ? Array.from({ length }, (_, index) => record.i32(advancesAt + index * 4 * (pairs ? 2 : 1)))
            : undefined
        const area = rectangle(56)
        const boxed = area.right > area.left && area.bottom > area.top
        canvas.text(...point(36), words, { advances, opaque: options & 0x0002 && boxed ? area : undefined, clip: options & 0x0004 && boxed ? area : undefined })
        break
      }
      case 108: {
        const length = Math.min(record.u32(16), 32_768)
        const options = record.u32(20)
        const boxed = (options & 0x0100) === 0
        const start = boxed ? 52 : 36
        const narrow = (options & 0x0200) !== 0
        const text = record.slice(start, length * (narrow ? 1 : 2))
        if (text) canvas.text(...point(8), narrow ? decoderOf(state.font.charset).decode(text) : new TextDecoder('utf-16le').decode(text))
        break
      }
      case 118: {
        const vertices = Math.min(record.u32(24), 4096)
        const count = record.u32(28)
        const mode = record.u32(32)
        const vertex = (index: number) => {
          const place = 36 + index * 16
          const hex = (value: number) => (value >> 8).toString(16).padStart(2, '0')
          return {
            x: record.i32(place),
            y: record.i32(place + 4),
            colour: `#${hex(record.u16(place + 8))}${hex(record.u16(place + 10))}${hex(record.u16(place + 12))}`
          }
        }
        const after = 36 + vertices * 16
        const held = Math.floor(Math.max(0, record.length - after) / (mode === 2 ? 12 : 8))
        for (let index = 0; index < Math.min(count, held, 4096); index++) {
          if (mode === 2) {
            const corners = [0, 1, 2].map((corner) => vertex(record.u32(after + index * 12 + corner * 4)))
            canvas.solid(
              canvas.polyline(
                corners.map(({ x, y }) => [x, y] as Point),
                { closed: true }
              ),
              corners[0]?.colour ?? BLACK
            )
          } else {
            const from = vertex(record.u32(after + index * 8))
            const to = vertex(record.u32(after + index * 8 + 4))
            canvas.gradient(box(from.x, from.y, to.x, to.y), from.colour, to.colour, mode === 1)
          }
        }
        break
      }
    }
  }
  canvas.flushLine()
  // A picture of EMF+ alone keeps nothing EMF draws.
  const drawnIn = frameBox ?? canvas.extent
  if (!canvas.drawn || !validBox(drawnIn)) return undefined
  const shown = sizeOf(drawnIn)
  return { svg: canvas.svg(drawnIn, shown.width, shown.height), width: shown.width, height: shown.height }
}

/** The boxes of a region (`RgnData`): a header of 32 bytes counting them, then each box. */
function regionBoxes(record: Reader, at: number): Box[] {
  const count = Math.min(record.u32(at + 8), 10_000)
  const found: Box[] = []
  for (let index = 0; index < count; index++) {
    const place = at + 32 + index * 16
    if (!record.has(place, 16)) break
    found.push(box(record.i32(place), record.i32(place + 4), record.i32(place + 8), record.i32(place + 12)))
  }
  return found
}

const regionPath = (found: Box) => `M${number(found.left)} ${number(found.top)}H${number(found.right)}V${number(found.bottom)}H${number(found.left)}Z`
