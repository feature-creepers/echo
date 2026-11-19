/**
 * StarView metafiles drawn as SVG (docs/SPEC.md, section 9.7): the pictures LibreOffice and OpenOffice keep of an
 * object in an OpenDocument file (`ObjectReplacements/`), an equation or a chart as it was last drawn. A StarView
 * metafile (`VCLMTF`) records the drawing calls of their toolkit, each an action with its version and length: lines,
 * shapes and polygons with curves, text placed by its characters' positions, bitmaps, gradients' fallbacks, colours,
 * fonts, mappings and the states saved and restored. Each is played on the canvas Windows' metafiles are played on
 * (`metafile-canvas.ts`), in hundredths of a millimetre. An action it does not draw is passed over by its length.
 *
 * Every read is checked against the action that holds it, so a damaged metafile draws what came before the damage.
 */

import {
  type Bitmap,
  type Box,
  box,
  Canvas,
  type DrawnMetafile,
  dibBitmap,
  type Font,
  IDENTITY,
  type Matrix,
  type MetafileHint,
  multiply,
  type Point,
  PS_NULL,
  Reader,
  validBox
} from './metafile-canvas.ts'

/** The most actions played, and how deep pictures may sit within pictures. */
const ACTION_LIMIT = 500_000
const DEPTH_LIMIT = 8

/** Millimetres in each of StarView's units, by their number: hundredths of one up to centimetres, inches' parts, points, twips, pixels. */
const MILLIMETRES = [0.01, 0.1, 1, 10, 0.0254, 0.254, 2.54, 25.4, 25.4 / 72, 25.4 / 1440, 25.4 / 96]
const RELATIVE = 13

/** A device unit of the drawing is a hundredth of a millimetre; a pixel at 96 to the inch is this many of them. */
const PIXEL = 2540 / 96

/** How the picture's units map to hundredths of a millimetre: its unit, its origin and its scales. */
interface Mapping {
  unit: number
  origin: Point
  scale: Point
}

/** A colour as StarView keeps it, its transparency in its high byte; none when it is wholly transparent. */
function colourOf(value: number): { colour: string; opacity: number } | undefined {
  const transparency = value >>> 24
  if (transparency === 0xff) return undefined
  return { colour: `#${(value & 0xffffff).toString(16).padStart(6, '0')}`, opacity: 1 - transparency / 255 }
}

/** An action's version and the length of what follows it (`VersionCompat`). */
function compat(action: Reader, at: number): { version: number; start: number; end: number } {
  const length = action.u32(at + 2)
  return { version: action.u16(at), start: at + 6, end: Math.min(at + 6 + length, action.length) }
}

/** A mapping (`MapMode`): its unit, origin, scales as fractions, and whether it is simple, its unit alone. */
function readMapping(action: Reader, at: number): Mapping | undefined {
  const { start } = compat(action, at)
  const unit = action.i16(start)
  if (unit < 0 || unit > RELATIVE) return undefined
  if (action.u8(start + 26) !== 0) return { unit, origin: [0, 0], scale: [1, 1] }
  const fraction = (place: number) => {
    const denominator = action.i32(place + 4)
    return denominator === 0 ? 1 : action.i32(place) / denominator
  }
  const scale: Point = [fraction(start + 10), fraction(start + 18)]
  if (!scale.every((value) => Number.isFinite(value) && Math.abs(value) < 1e5 && value !== 0)) return undefined
  return { unit, origin: [action.i32(start + 2), action.i32(start + 6)], scale }
}

/** The matrix from a mapping's units to hundredths of a millimetre. */
function mappingMatrix(mapping: Mapping): Matrix {
  const millimetres = (MILLIMETRES[mapping.unit] ?? 0.01) * 100
  const [scaleX, scaleY] = [mapping.scale[0] * millimetres, mapping.scale[1] * millimetres]
  return [scaleX, 0, 0, scaleY, mapping.origin[0] * scaleX, mapping.origin[1] * scaleY]
}

/** A mapping changed by another: a relative one scales and moves the one before it, any other replaces it. */
function changedMapping(before: Mapping, change: Mapping): Mapping {
  if (change.unit !== RELATIVE) return change
  return {
    unit: before.unit,
    origin: [before.origin[0] + change.origin[0] / (before.scale[0] || 1), before.origin[1] + change.origin[1] / (before.scale[1] || 1)],
    scale: [before.scale[0] * change.scale[0], before.scale[1] * change.scale[1]]
  }
}

/**
 * A string as the font before it says: of 8-bit characters after its length in two bytes, in Western European; or,
 * for a font of Unicode (`unicode`), of 16-bit ones after their count in four.
 */
function narrowString(action: Reader, at: number, unicode = false): { text: string; next: number } {
  if (unicode) {
    const count = Math.min(action.u32(at), Math.max(0, action.length - at - 4) >> 1)
    const bytes = action.slice(at + 4, count * 2)
    return { text: bytes ? new TextDecoder('utf-16le').decode(bytes) : '', next: at + 4 + count * 2 }
  }
  const length = action.u16(at)
  const bytes = action.slice(at + 2, length)
  return { text: bytes ? new TextDecoder('windows-1252').decode(bytes) : '', next: at + 2 + length }
}

/** A string of 16-bit characters after its length in two bytes. */
function wideString(action: Reader, at: number): { text: string; next: number } {
  const length = action.u16(at)
  const bytes = action.slice(at + 2, length * 2)
  return { text: bytes ? new TextDecoder('utf-16le').decode(bytes) : '', next: at + 2 + length * 2 }
}

/** A polygon: its points, and when it has them, the flags that make some of them a curve's control points. */
function readPolygon(action: Reader, at: number, flagged: boolean): { points: Point[]; controls: number[] | undefined; next: number } {
  // A polygon with flags has a version and length of its own before its points (`Polygon::Read`).
  const outer = flagged ? compat(action, at) : undefined
  const from = outer ? outer.start : at
  const count = Math.min(action.u16(from), Math.max(0, Math.floor((action.length - from - 2) / 8)))
  const points: Point[] = []
  for (let index = 0; index < count; index++) points.push([action.i32(from + 2 + index * 8), action.i32(from + 6 + index * 8)])
  let next = from + 2 + count * 8
  let controls: number[] | undefined
  if (outer) {
    if (action.u8(next) !== 0) controls = Array.from({ length: count }, (_, index) => action.u8(next + 1 + index))
    next = outer.end
  }
  return { points, controls, next }
}

/** A line's look (`LineInfo`): its style, none, solid or dashed, and its width. */
function readLine(action: Reader, at: number): { style: number; width: number; next: number } {
  const { start, end } = compat(action, at)
  return { style: action.u16(start), width: action.i32(start + 2), next: end }
}

/** The look of a font (`Font`), as the canvas draws one: its face, height, weight, slant, lines and turn. */
function readFont(action: Reader, at: number): Font {
  const { start } = compat(action, at)
  const family = narrowString(action, start)
  const style = narrowString(action, family.next)
  const place = style.next
  const height = action.i32(place + 4)
  const weight = action.u16(place + 14)
  return {
    face: family.text,
    // StarView's height is its characters', as Windows' is when it is negative.
    height: -Math.abs(height),
    // Its weights from thin to black, as Windows numbers them.
    weight: weight === 0 ? 400 : Math.min(900, Math.max(100, (weight - 1) * 100)),
    // Lines and slants of their kinds; one StarView does not know is none.
    underline: [1, 2, 3].includes(action.u16(place + 16)) || action.u16(place + 16) > 4,
    strike: [1, 2].includes(action.u16(place + 18)) || action.u16(place + 18) > 3,
    italic: action.u16(place + 20) === 1 || action.u16(place + 20) === 2,
    escapement: action.i16(place + 26),
    // Its characters' encoding: 0xFFFF is Unicode, whose strings are written in 16 bits.
    charset: action.u16(place + 8)
  }
}

/** A bitmap as a file the window shows: a `.bmp` behind its file header, its pixels where the header says. */
function readBitmap(action: Reader, at: number): Bitmap | undefined {
  if (action.u16(at) !== 0x4d42) return undefined
  const size = action.u32(at + 2)
  const offset = action.u32(at + 10)
  const information = action.slice(at + 14, offset - 14)
  const pixels = action.slice(at + offset, size - offset)
  // A bitmap StarView packed with zlib is not drawn.
  if (!information || !pixels || new DataView(information.buffer, information.byteOffset).getUint32(16, true) > 6) return undefined
  return dibBitmap(information, pixels)
}

/** The encoding StarView names Unicode by. */
const UNICODE = 0xffff

/** What StarSymbol's private characters, which StarMath draws its symbols with, stand for. */
const STAR_SYMBOLS: Record<number, string> = {
  57377: '©',
  57380: '®',
  57397: ' ',
  57398: '(',
  57399: ')',
  57401: ' ',
  57475: '+',
  57476: '<',
  57477: '>',
  57478: '≤',
  57479: '≥',
  57481: '∈',
  57482: 'ƒ',
  57484: '→',
  57485: '√',
  57486: '√',
  57487: '√',
  57492: '′',
  57502: '(',
  57503: ')',
  57504: '∠',
  57510: '′',
  57511: '|',
  57512: '/',
  57515: '|',
  57557: '∂',
  57563: '←',
  57564: '↑',
  57565: '↓'
}
// Its Greek letters, capitals then small ones, in StarMath's order.
for (const [index, letter] of [...'ΓΔΘΛΞΠΣΥΦΨΩαβγδεζηθικλμνξοπρστυφχψωεϑϖ'].entries()) STAR_SYMBOLS[0xe0ac + index] = letter
STAR_SYMBOLS[0xe0d3] = 'ς'
STAR_SYMBOLS[0xe0d4] = 'ϕ'

/** Text alignment as the canvas takes it: the top, the baseline or the bottom of its characters at the point. */
const ALIGNS = [0, 24, 8]

/** The player of a metafile's actions: its canvas, the mappings saved with each state, and the matrix it is drawn into. */
class Player {
  readonly canvas: Canvas
  private mapping: Mapping
  private readonly saved: Mapping[] = []
  private outer: Matrix
  private played = 0

  constructor(mapping: Mapping) {
    this.mapping = mapping
    this.outer = IDENTITY
    this.canvas = new Canvas(() => multiply(this.outer, mappingMatrix(this.mapping)))
    this.canvas.pixel = PIXEL
    this.canvas.state.align = 24
    this.canvas.state.pen = { ...this.canvas.state.pen, colour: '#000000' }
    this.canvas.state.opaque = false
  }

  /** The actions of a metafile from a place, as many as it counts. */
  play(file: Reader, from: number, count: number, depth: number): void {
    let at = from
    for (let index = 0; index < count && at + 8 <= file.length && !this.canvas.full; index++) {
      if (++this.played > ACTION_LIMIT) return
      const type = file.u16(at)
      const { end } = compat(file, at + 2)
      try {
        this.action(type, file, at + 2, depth)
      } catch {
        // An action that cannot be read draws nothing; the next is found by its length.
      }
      at = end
    }
  }

  private path(points: readonly Point[], controls: readonly number[] | undefined, closed: boolean): string {
    if (!controls) return this.canvas.polyline(points, { closed })
    // A point flagged 2 is a control point: two of them between points make a curve.
    let data = ''
    const at = (point: Point) => this.canvas.point(point[0], point[1])
    for (let index = 0; index < points.length; index++) {
      const point = points[index] as Point
      if (index === 0) data = `M${at(point)}`
      else if (controls[index] === 2 && controls[index + 1] === 2 && points[index + 2]) {
        data += `C${at(point)} ${at(points[index + 1] as Point)} ${at(points[index + 2] as Point)}`
        index += 2
      } else data += `L${at(point)}`
    }
    return closed && data ? `${data}Z` : data
  }

  private polygons(action: Reader, at: number): { data: string; next: number } {
    const count = action.u16(at)
    let next = at + 2
    let data = ''
    for (let index = 0; index < count && next < action.length; index++) {
      const polygon = readPolygon(action, next, false)
      data += this.path(polygon.points, undefined, true)
      next = polygon.next
    }
    return { data, next }
  }

  private rectangle(action: Reader, at: number): Box {
    return box(action.i32(at), action.i32(at + 4), action.i32(at + 8), action.i32(at + 12))
  }

  private text(x: number, y: number, text: string, advances?: number[]): void {
    // StarMath's symbols in StarSymbol's own characters, as the ones they stand for.
    const shown = /^(star|open)symbol$/i.test(this.canvas.state.font.face)
      ? [...text].map((character) => STAR_SYMBOLS[character.charCodeAt(0)] ?? character).join('')
      : text
    this.canvas.text(x, y, shown, advances ? { advances } : {})
  }

  private action(type: number, file: Reader, at: number, depth: number): void {
    const { version, start, end } = compat(file, at)
    const action = new Reader(file.bytes.subarray(0, end))
    const canvas = this.canvas
    const state = canvas.state
    switch (type) {
      case 100:
      case 101: {
        const [x, y] = [action.i32(start), action.i32(start + 4)]
        canvas.solid(canvas.rectangle(box(x, y, x + 1, y + 1)), type === 100 ? (colourOf(action.u32(start + 8))?.colour ?? '#000000') : state.pen.colour)
        break
      }
      case 102: {
        const from: Point = [action.i32(start), action.i32(start + 4)]
        const to: Point = [action.i32(start + 8), action.i32(start + 12)]
        const pen = state.pen
        if (version >= 2) {
          const line = readLine(action, start + 16)
          if (line.style === 0) break
          state.pen = { ...pen, width: line.width, cosmetic: line.width === 0, style: line.style === 2 ? 1 : 0 }
        }
        canvas.shape(canvas.polyline([from, to]), false)
        state.pen = pen
        break
      }
      case 103:
        canvas.shape(canvas.rectangle(this.rectangle(action, start)), true)
        break
      case 104:
        canvas.shape(canvas.roundRectangle(this.rectangle(action, start), action.u32(start + 16), action.u32(start + 20)), true)
        break
      case 105:
        canvas.shape(canvas.ellipse(this.rectangle(action, start)), true)
        break
      case 106:
      case 107:
      case 108: {
        // An arc from where a line from the centre to one point meets the ellipse to where one to the other does; a pie closed to the centre, a chord across.
        const rectangle = this.rectangle(action, start)
        const from: Point = [action.i32(start + 16), action.i32(start + 20)]
        const to: Point = [action.i32(start + 24), action.i32(start + 28)]
        const { data } = canvas.arcBetween(rectangle, from, to, 'move')
        const centre = canvas.point((rectangle.left + rectangle.right) / 2, (rectangle.top + rectangle.bottom) / 2)
        if (type === 106) canvas.shape(data, false)
        else canvas.shape(type === 107 ? `${data}L${centre}Z` : `${data}Z`, true)
        break
      }
      case 109: {
        let polygon = readPolygon(action, start, false)
        const pen = state.pen
        if (version >= 2) {
          const line = readLine(action, polygon.next)
          if (line.style === 0) break
          state.pen = { ...pen, width: line.width, cosmetic: line.width === 0, style: line.style === 2 ? 1 : 0 }
          if (version >= 3 && action.u8(line.next) !== 0) polygon = readPolygon(action, line.next + 1, true)
        }
        canvas.shape(this.path(polygon.points, polygon.controls, false), false)
        state.pen = pen
        break
      }
      case 110: {
        let polygon = readPolygon(action, start, false)
        if (version >= 2 && action.u8(polygon.next) !== 0) polygon = readPolygon(action, polygon.next + 1, true)
        canvas.shape(this.path(polygon.points, polygon.controls, true), true)
        break
      }
      case 111: {
        // A polygon of several, those with curves given again with their flags after them.
        const count = action.u16(start)
        const polygons: { points: Point[]; controls: number[] | undefined }[] = []
        let next = start + 2
        for (let index = 0; index < count && next < end; index++) {
          const polygon = readPolygon(action, next, false)
          polygons.push(polygon)
          next = polygon.next
        }
        if (version >= 2)
          for (let complex = action.u16(next), place = next + 2; complex > 0 && place < end; complex--) {
            const index = action.u16(place)
            const polygon = readPolygon(action, place + 2, true)
            if (index < polygons.length) polygons[index] = polygon
            place = polygon.next
          }
        canvas.shape(polygons.map((polygon) => this.path(polygon.points, polygon.controls, true)).join(''), true)
        break
      }
      case 112:
      case 114: {
        // Text at a point, a part of it by its first character and length; a stretched text, at its own width.
        const [x, y] = [action.i32(start), action.i32(start + 4)]
        const narrow = narrowString(action, start + 8, state.font.charset === UNICODE)
        const after = narrow.next + (type === 114 ? 4 : 0)
        const first = action.u16(after)
        const length = action.u16(after + 2)
        const text = version >= 2 ? wideString(action, after + 4).text : narrow.text
        this.text(x, y, text.slice(first, first + length))
        break
      }
      case 113: {
        // Text at a point with each character's end, from the start, as its array gives them.
        const [x, y] = [action.i32(start), action.i32(start + 4)]
        const narrow = narrowString(action, start + 8, state.font.charset === UNICODE)
        const first = action.u16(narrow.next)
        const length = action.u16(narrow.next + 2)
        const count = Math.max(0, Math.min(action.i32(narrow.next + 4), length, Math.floor((end - narrow.next - 8) / 4)))
        const ends = Array.from({ length: count }, (_, index) => action.i32(narrow.next + 8 + index * 4))
        const text = version >= 2 ? wideString(action, narrow.next + 8 + count * 4).text : narrow.text
        const shown = text.slice(first, first + length)
        const advances = ends.length >= [...shown].length && ends.length > 0 ? ends.map((value, index) => value - (ends[index - 1] ?? 0)) : undefined
        this.text(x, y, shown, advances)
        break
      }
      case 115: {
        const rectangle = this.rectangle(action, start)
        const narrow = narrowString(action, start + 16, state.font.charset === UNICODE)
        const text = version >= 2 ? wideString(action, narrow.next + 2).text : narrow.text
        const align = state.align
        state.align = 0
        text.split(/\r\n|\r|\n/).forEach((line, index) => {
          this.text(rectangle.left, rectangle.top + index * Math.abs(state.font.height || 400) * 1.15, line)
        })
        state.align = align
        break
      }
      case 116:
      case 117:
      case 118:
      case 119:
      case 120:
      case 121: {
        // A bitmap at a point at its own size in pixels, or in a box, or a part of it in a box; with its mask after it, drawn whole.
        const bitmap = readBitmap(action, start)
        if (!bitmap) break
        // Past the bitmap, its mask when it has one, then where it goes.
        const size = action.u32(start + 2)
        let place = start + size
        if (type >= 119) place = this.pastMask(action, place, end)
        const [x, y] = [action.i32(place), action.i32(place + 4)]
        const scaled = type !== 116 && type !== 119
        const matrix = canvas.matrix()
        const [width, height] = scaled
          ? [action.i32(place + 8), action.i32(place + 12)]
          : [(bitmap.width * PIXEL) / (Math.hypot(matrix[0], matrix[1]) || 1), (bitmap.height * PIXEL) / (Math.hypot(matrix[2], matrix[3]) || 1)]
        const part =
          type === 118 || type === 121
            ? box(
                action.i32(place + 16),
                action.i32(place + 20),
                action.i32(place + 16) + action.i32(place + 24),
                action.i32(place + 20) + action.i32(place + 28)
              )
            : undefined
        canvas.bitmap(box(x, y, x + width, y + height), bitmap, part)
        break
      }
      case 125: {
        // A gradient in a box: from its first colour to its last, along its angle, each by its intensity.
        const rectangle = this.rectangle(action, start)
        const gradient = compat(action, start + 16).start
        const intensity = (colour: number, percent: number) => {
          const scaled = (shift: number) => Math.round((((colour >> shift) & 0xff) * Math.min(percent, 100)) / 100)
          return `#${[16, 8, 0].map((shift) => scaled(shift).toString(16).padStart(2, '0')).join('')}`
        }
        const from = intensity(action.u32(gradient + 2), action.u16(gradient + 18))
        const to = intensity(action.u32(gradient + 6), action.u16(gradient + 20))
        const angle = action.u16(gradient + 10) % 3600
        const vertical = angle < 450 || angle >= 3150 || (angle >= 1350 && angle < 2250)
        const reversed = angle >= 1350 && angle < 3150
        canvas.gradient(rectangle, reversed ? to : from, reversed ? from : to, vertical)
        break
      }
      case 128:
        // A clipping of a region is not followed; one taken away is.
        if (action.u8(end - 1) === 0) state.clip = undefined
        break
      case 129:
        canvas.intersectClip(this.rectangle(action, start))
        break
      case 132:
      case 133: {
        const colour = colourOf(action.u32(start))
        const set = action.u8(start + 4) !== 0 && colour !== undefined
        if (type === 132) state.pen = set ? { style: 0, width: 0, colour: colour.colour, cosmetic: true } : { ...state.pen, style: PS_NULL }
        else state.brush = set ? { style: 'solid', colour: colour.colour, hatch: 0 } : { ...state.brush, style: 'none' }
        break
      }
      case 134:
        state.textColour = colourOf(action.u32(start))?.colour ?? '#000000'
        break
      case 135: {
        const colour = colourOf(action.u32(start))
        state.opaque = action.u8(start + 4) !== 0 && colour !== undefined
        if (colour) state.background = colour.colour
        break
      }
      case 136:
        state.align = ALIGNS[action.u16(start)] ?? 24
        break
      case 137: {
        const mapping = readMapping(action, start)
        if (mapping) this.mapping = changedMapping(this.mapping, mapping)
        break
      }
      case 138:
        state.font = readFont(action, start)
        break
      case 139:
        canvas.save()
        if (this.saved.length < 256) this.saved.push(this.mapping)
        break
      case 140:
        canvas.restore(-1)
        this.mapping = this.saved.pop() ?? this.mapping
        break
      case 142: {
        // Polygons filled through a share of their own transparency.
        const { data, next } = this.polygons(action, start)
        const percent = Math.min(action.u16(next), 100)
        if (state.brush.style === 'solid') canvas.solid(data, state.brush.colour, 1 - percent / 100)
        break
      }
      case 147: {
        // A picture within the picture, drawn in its box.
        if (depth >= DEPTH_LIMIT) break
        const inner = header(action, start)
        if (!inner) break
        const place = inner.end
        const [x, y, width, height] = [action.i32(place), action.i32(place + 4), action.i32(place + 8), action.i32(place + 12)]
        const frame = innerFrame(inner)
        if (!frame || width === 0 || height === 0) break
        const outer = this.outer
        const mapping = this.mapping
        const saved = { ...state }
        const fit: Matrix = [
          width / (frame.right - frame.left),
          0,
          0,
          height / (frame.bottom - frame.top),
          x - (frame.left * width) / (frame.right - frame.left),
          y - (frame.top * height) / (frame.bottom - frame.top)
        ]
        // The inner picture's units are mapped to the outer's, into its box.
        this.outer = multiply(multiply(outer, mappingMatrix(mapping)), multiply(fit, invert(mappingMatrix(inner.mapping))))
        this.mapping = inner.mapping
        this.play(action, inner.actions, inner.count, depth + 1)
        this.outer = outer
        this.mapping = mapping
        canvas.state = saved
        break
      }
    }
  }

  /** Where a bitmap's mask ends (`BitmapEx`): after a mark of eight bytes, its kind, then a bitmap or a colour. */
  private pastMask(action: Reader, at: number, end: number): number {
    if (action.u32(at) !== 0x25091962 || action.u32(at + 4) !== 0xacb20201) return at
    const kind = action.u8(at + 8)
    if (kind === 2 && action.u16(at + 9) === 0x4d42) return Math.min(at + 9 + action.u32(at + 11), end)
    if (kind === 1) return at + 13
    return at + 9
  }
}

/** The inverse of a matrix of scales and a move. */
const invert = (matrix: Matrix): Matrix => [1 / (matrix[0] || 1), 0, 0, 1 / (matrix[3] || 1), -matrix[4] / (matrix[0] || 1), -matrix[5] / (matrix[3] || 1)]

/** A metafile's header: its mapping, its size in that mapping, where its actions start and how many there are. */
interface Header {
  mapping: Mapping
  size: Point
  actions: number
  count: number
  end: number
}

function header(file: Reader, at: number): Header | undefined {
  const mark = file.slice(at, 6)
  if (!mark || new TextDecoder('latin1').decode(mark) !== 'VCLMTF') return undefined
  const { start, end } = compat(file, at + 6)
  const mapping = readMapping(file, start + 4)
  if (!mapping || mapping.unit === RELATIVE) return undefined
  const sizeAt = start + 4 + 6 + file.u32(start + 4 + 2)
  const size: Point = [file.i32(sizeAt), file.i32(sizeAt + 4)]
  const count = Math.min(file.u32(sizeAt + 8), ACTION_LIMIT)
  // The actions follow the header; a nested picture's end is where its last action ends, found by playing them.
  let next = end
  for (let index = 0; index < count && next + 8 <= file.length; index++) next = compat(file, next + 2).end
  return { mapping, size, actions: end, count, end: next }
}

/** The box a metafile's header gives, in hundredths of a millimetre: from its origin, its size in its own units. */
function innerFrame(found: Header): Box | undefined {
  const millimetres = (MILLIMETRES[found.mapping.unit] ?? 0.01) * 100
  const frame = box(0, 0, found.size[0] * found.mapping.scale[0] * millimetres, found.size[1] * found.mapping.scale[1] * millimetres)
  if (!validBox(frame)) return undefined
  const matrix = mappingMatrix(found.mapping)
  // The frame back in the picture's own units, as the box it is fitted from.
  return box(
    frame.left / matrix[0] - found.mapping.origin[0],
    frame.top / matrix[3] - found.mapping.origin[1],
    frame.right / matrix[0] - found.mapping.origin[0],
    frame.bottom / matrix[3] - found.mapping.origin[1]
  )
}

/** Whether bytes are a StarView metafile, by their first six. */
export const isStarView = (bytes: Uint8Array): boolean => bytes.length > 6 && new TextDecoder('latin1').decode(bytes.subarray(0, 6)) === 'VCLMTF'

/**
 * A StarView metafile drawn as SVG, at the size its header gives, its units mapped to hundredths of a millimetre; none
 * for one that is not one or draws nothing.
 */
export function drawStarView(bytes: Uint8Array, hint: MetafileHint = {}): DrawnMetafile | undefined {
  const file = new Reader(bytes)
  const found = header(file, 0)
  if (!found) return undefined
  const player = new Player(found.mapping)
  player.play(file, found.actions, found.count, 0)
  const millimetres = (MILLIMETRES[found.mapping.unit] ?? 0.01) * 100
  let frame: Box | undefined = box(0, 0, found.size[0] * found.mapping.scale[0] * millimetres, found.size[1] * found.mapping.scale[1] * millimetres)
  if (!validBox(frame)) frame = player.canvas.extent && validBox(player.canvas.extent) ? player.canvas.extent : undefined
  if (!frame || !player.canvas.drawn) return undefined
  const width = hint.width ?? (frame.right - frame.left) / PIXEL
  const height = hint.height ?? (frame.bottom - frame.top) / PIXEL
  return { svg: player.canvas.svg(frame, width, height), width, height }
}
