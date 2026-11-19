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

import { colourLeftOut, type Transparency, throughMask, transparencyOf } from './bitmap-mask.ts'
import {
  type Bitmap,
  BLACK,
  type Box,
  box,
  Canvas,
  colour,
  DEFAULT_BRUSH,
  DEFAULT_FONT,
  DEFAULT_PEN,
  type DrawingObject,
  type DrawnMetafile,
  dibBitmap,
  fallbackSize,
  IDENTITY,
  type Matrix,
  type MetafileHint,
  MM_ANISOTROPIC,
  MM_ISOTROPIC,
  MM_TEXT,
  multiply,
  number,
  type Point,
  PS_NULL,
  packedBitmap,
  Reader,
  type State,
  validBox,
  WHITE
} from './metafile-canvas.ts'

import { drawStarView, isStarView } from './starview.ts'

export { type DrawnMetafile, dibBitmap, type MetafileHint, shownSize } from './metafile-canvas.ts'

/** The most records played: past them, the picture is drawn as far as it got. */
const RECORD_LIMIT = 500_000

/** AND of a bitmap and the picture under it: a mask, left out when its pixels cannot be read, as it would black it. */
const SRCAND = 0x008800c6

/**
 * A bitmap drawn as Windows draws it through a raster operation, a colour left out or each pixel's opacity: through a
 * mask of the pixels that show (`bitmap-mask.ts`), or not at all when none does.
 */
function drawBitmap(
  canvas: Canvas,
  destination: Box,
  bitmap: Bitmap,
  source: Box | undefined,
  transparency: Transparency | undefined,
  options: { opacity?: number; fromBottom?: boolean; operation?: number } = {}
) {
  const { operation, ...placed } = options
  const shown = transparency ? throughMask(bitmap, transparency) : undefined
  if (shown === 'nothing' || (!shown && operation === SRCAND)) return
  canvas.bitmap(destination, shown?.picture ?? bitmap, source, { ...placed, mask: shown?.mask })
}

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

/** The units per millimetre of the fixed mappings (`SetMapMode`). */
const UNITS_PER_MILLIMETRE: Record<number, number> = { 2: 10, 3: 100, 4: 100 / 25.4, 5: 1000 / 25.4, 6: 1440 / 25.4 }

/** The kind of a metafile by its first bytes: EMF, WMF behind its placeable header or without it, StarView's, or none. */
export function metafileKind(bytes: Uint8Array): 'emf' | 'wmf' | 'svm' | undefined {
  if (isStarView(bytes)) return 'svm'
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
    return kind === 'emf' ? drawEnhanced(bytes, hint) : kind === 'wmf' ? drawWindows(bytes, hint) : kind === 'svm' ? drawStarView(bytes, hint) : undefined
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
        const operation = record.u32(0)
        if (bitmap)
          drawBitmap(
            canvas,
            box(word(10), word(9), word(10) + word(8), word(9) + word(7)),
            bitmap,
            box(word(6), word(5), word(6) + word(4), word(5) + word(3)),
            transparencyOf(operation),
            { fromBottom: true, operation }
          )
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
          if (bitmap) drawBitmap(canvas, destination, bitmap, source, transparencyOf(operation), { operation })
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
        // A blend's fourth byte says each pixel keeps its opacity (`AC_SRC_ALPHA`); a transparent copy names the colour it leaves out.
        if (type === 114)
          drawBitmap(canvas, destination, bitmap, source, operation >>> 24 === 1 ? { kind: 'alpha' } : undefined, {
            opacity: ((operation >>> 16) & 0xff) / 255
          })
        else if (type === 116) drawBitmap(canvas, destination, bitmap, source, colourLeftOut(operation))
        else drawBitmap(canvas, destination, bitmap, source, transparencyOf(operation), { operation })
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
        if (bitmap)
          drawBitmap(
            canvas,
            box(record.i32(24), record.i32(28), record.i32(24) + record.i32(72), record.i32(28) + record.i32(76)),
            bitmap,
            box(record.i32(32), record.i32(36), record.i32(32) + record.i32(40), record.i32(36) + record.i32(44)),
            transparencyOf(operation),
            { fromBottom: true, operation }
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
