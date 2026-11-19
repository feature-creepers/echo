/**
 * What every metafile is drawn on (docs/SPEC.md, section 9.7): a canvas that keeps the state records change (pens,
 * brushes, fonts, colours, the mapping from the picture's units to the device's, paths and clipping) and writes the
 * SVG they draw, shapes as paths in the device's units, text and bitmaps placed by the mapping. Windows' metafiles
 * (`metafile.ts`) and StarView's (`starview.ts`) play their records on it.
 */

/** The most characters of SVG written: past them, the picture is drawn as far as it got. */
export const SVG_LIMIT = 24 * 1024 * 1024

/** The longest side of a picture whose size nothing gives, in pixels. */
export const FALLBACK_SIDE = 480

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

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export type Matrix = readonly [number, number, number, number, number, number]
export type Point = readonly [number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** The matrix that applies `inner`, then `outer`. */
export const multiply = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5]
]

export const apply = (matrix: Matrix, x: number, y: number): Point => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]

/** A number as SVG takes it: two decimals at most. */
export const number = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0')

export const MARKS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Text written into SVG: its marks escaped, and the characters XML does not take left out. */
export const escaped = (text: string) => {
  let written = ''
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0xfffe || code === 0xffff) continue
    written += MARKS[character] ?? character
  }
  return written
}

/** A colour as Windows keeps it, red in its low byte; one named by its place in a palette is drawn black. */
export const colour = (value: number) => {
  if (value >>> 24 === 0x01) return '#000000'
  const hex = (shift: number) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0')
  return `#${hex(0)}${hex(8)}${hex(16)}`
}

/** Bytes as base64, a piece at a time. */
export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

/** Little-endian numbers from a record, each read checked against its end: a read past it gives zero. */
export class Reader {
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
export interface Bitmap {
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
export function packedBitmap(bytes: Uint8Array): Bitmap | undefined {
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

export interface Pen {
  style: number
  width: number
  colour: string
  /** A pen of one pixel whatever the mapping, as Windows draws a pen of no width or a cosmetic one. */
  cosmetic: boolean
}

export interface Brush {
  style: 'solid' | 'none' | 'hatch' | 'pattern'
  colour: string
  hatch: number
  bitmap?: Bitmap | undefined
}

export interface Font {
  height: number
  escapement: number
  weight: number
  italic: boolean
  underline: boolean
  strike: boolean
  charset: number
  face: string
}

export type DrawingObject = { kind: 'pen'; pen: Pen } | { kind: 'brush'; brush: Brush } | { kind: 'font'; font: Font } | { kind: 'other' }

export const PS_NULL = 5
export const BLACK = '#000000'
export const WHITE = '#ffffff'
export const DEFAULT_PEN: Pen = { style: 0, width: 0, colour: BLACK, cosmetic: true }
export const DEFAULT_BRUSH: Brush = { style: 'solid', colour: WHITE, hatch: 0 }
export const DEFAULT_FONT: Font = { height: 0, escapement: 0, weight: 400, italic: false, underline: false, strike: false, charset: 0, face: '' }

/** How the picture's units map to the device's (`SetMapMode`): its own, or a box mapped to another. */
export const MM_TEXT = 1
export const MM_ISOTROPIC = 7
export const MM_ANISOTROPIC = 8

/** Everything a record may change and the next may use, saved and restored whole (`SaveDC`, `RestoreDC`). */
export interface State {
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

export const initialState = (): State => ({
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
export class Canvas {
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
  solid(data: string, fill: string, opacity = 1) {
    if (data) this.element(`<path d="${data}" fill="${fill}"${opacity < 1 ? ` fill-opacity="${number(Math.max(0, opacity))}"` : ''} stroke="none"/>`)
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
export const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

/** The dashes of each style of pen, in widths of the pen; the hatches of each style of brush, in sides of its tile. */
export const DASHES: Record<number, number[]> = { 1: [6, 2], 2: [1.5, 1.5], 3: [6, 2, 1.5, 2], 4: [6, 2, 1.5, 2, 1.5, 2] }
export const HATCHES: Record<number, number[][]> = {
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

export const validBox = (found: Box | undefined): found is Box =>
  found !== undefined && [found.left, found.top, found.right, found.bottom].every(Number.isFinite) && found.right > found.left && found.bottom > found.top

/** The size in pixels of a picture whose size nothing says: its box, made to fit a fallback side when larger. */
export function fallbackSize(found: Box): { width: number; height: number } {
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
