/**
 * A slide of PowerPoint 2007 and later drawn as it looks, in SVG (docs/SPEC.md, section 9.7): its background, the
 * shapes of its master and its layout under its own, each at its place with its geometry, fill and outline, its text
 * in its fonts, sizes, colours and alignment, its pictures cropped as the slide crops them, its tables, its charts and
 * its SmartArt. A placeholder takes what its slide leaves out from the layout's, then the master's: its place and its
 * text's styles. Colours come from the theme, through the master's map of them. Text is written as XHTML inside the
 * SVG (`foreignObject`), so it wraps as it does in its box. The window shows the SVG as an image, where nothing runs
 * and nothing is fetched: a picture is written into it as data.
 *
 * What cannot be read is left out of the drawing rather than failing it: a part that is missing, a picture of a format
 * the window does not show, a shape of a geometry not known here, drawn as its box.
 */

import { type Archive, partOf, relationships, textOf } from './archive.ts'
import { drawMetafile } from './metafile.ts'
import { pictureType } from './office-figures.ts'
import type { OfficeChart } from './office-text.ts'
import {
  type Box,
  base64,
  bulletCharacter,
  Canvas,
  chartElements,
  css,
  type DrawnSlide,
  type Fill,
  fillAttribute,
  fromHex,
  fromLightness,
  GROUP_DEPTH_LIMIT,
  listNumber,
  number,
  type Outline,
  type Paint,
  PICTURE_LIMIT,
  pictureElement,
  placed,
  presetPath,
  type RunStyle,
  rectanglePath,
  SHAPE_LIMIT,
  type ShapePath,
  shapeElement,
  slideSvg,
  strokeAttributes,
  type TextBullet,
  type TextFrame,
  type TextParagraph,
  type TextPiece,
  textDiv,
  textHtml,
  toLightness
} from './slide-svg.ts'
import { childAt, childrenNamed, textIn, type XmlNode, xmlTree } from './xml.ts'

/** English Metric Units to a pixel at 96 to the inch. */
const EMU_PER_PIXEL = 9525

/** A length of DrawingML, in English Metric Units, in pixels; a value that is no number is the fallback. */
const pixels = (value: string | undefined, fallback = 0) => {
  const found = Number(value)
  return value !== undefined && Number.isFinite(found) ? found / EMU_PER_PIXEL : fallback
}

// Colours

const PRESET_COLOURS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  gray: '808080',
  grey: '808080',
  orange: 'FFA500',
  purple: '800080',
  ltGray: 'D3D3D3',
  dkGray: 'A9A9A9'
}

/** A colour changed as its element's children say: lighter or darker, tinted, shaded, less opaque. */
function modified(paint: Paint, changes: readonly XmlNode[]): Paint {
  let result = { ...paint }
  for (const change of changes) {
    const value = Number(change.attributes.val) / 100_000
    if (!Number.isFinite(value)) continue
    if (change.name === 'a:lumMod' || change.name === 'a:lumOff' || change.name === 'a:satMod') {
      const [hue, saturation, lightness] = toLightness(result)
      if (change.name === 'a:lumMod') result = fromLightness(hue, saturation, Math.min(1, lightness * value), result.opacity)
      else if (change.name === 'a:lumOff') result = fromLightness(hue, saturation, Math.min(1, Math.max(0, lightness + value)), result.opacity)
      else result = fromLightness(hue, Math.min(1, saturation * value), lightness, result.opacity)
    } else if (change.name === 'a:shade') result = { ...result, red: result.red * value, green: result.green * value, blue: result.blue * value }
    else if (change.name === 'a:tint')
      result = { ...result, red: 255 - (255 - result.red) * value, green: 255 - (255 - result.green) * value, blue: 255 - (255 - result.blue) * value }
    else if (change.name === 'a:alpha') result = { ...result, opacity: value }
  }
  return result
}

// The deck

/** A part of the presentation, read for drawing: its tree, where it is, and what its relationships name. */
interface Part {
  path: string
  tree: XmlNode
  targets: Map<string, string>
}

async function readPart(archive: Archive, path: string | undefined): Promise<Part | undefined> {
  if (path === undefined) return undefined
  const xml = await textOf(archive, path)
  if (xml === undefined) return undefined
  return { path, tree: xmlTree(xml), targets: await relationships(archive, path) }
}

/** The theme's colours by their names, its fonts for headings and for text, and its styles of fill and of line. */
interface Theme {
  colours: Record<string, Paint>
  major: string
  minor: string
  fills: XmlNode[]
  backgrounds: XmlNode[]
  lines: XmlNode[]
}

function readTheme(tree: XmlNode | undefined): Theme {
  const elements = childAt(tree, 'a:theme', 'a:themeElements')
  const colours: Record<string, Paint> = {}
  for (const entry of childAt(elements, 'a:clrScheme')?.children ?? []) {
    const value = entry.children.find((child) => child.name === 'a:srgbClr' || child.name === 'a:sysClr')
    const paint = fromHex(value?.name === 'a:sysClr' ? value.attributes.lastClr : value?.attributes.val)
    if (paint) colours[entry.name.replace(/^a:/, '')] = paint
  }
  const font = (kind: string) => childAt(elements, 'a:fontScheme', kind, 'a:latin')?.attributes.typeface ?? ''
  const styles = (list: string) => childAt(elements, 'a:fmtScheme', list)?.children.filter((child) => child.name !== '#text') ?? []
  return {
    colours,
    major: font('a:majorFont'),
    minor: font('a:minorFont'),
    fills: styles('a:fillStyleLst'),
    backgrounds: styles('a:bgFillStyleLst'),
    lines: styles('a:lnStyleLst')
  }
}

/** What a slide is drawn with: its parts, its theme and map of colours, the master's text styles, and its charts. */
interface Deck {
  archive: Archive
  theme: Theme
  colourMap: Record<string, string>
  master: Part
  layout: Part | undefined
  slide: Part
  defaultText: XmlNode | undefined
  chart: (part: string) => Promise<OfficeChart | undefined>
  pictureBytes: number
}

/** A colour of an element that holds one (`a:srgbClr`, `a:schemeClr`…), `phClr` being the colour a style reference gives. */
function paintOf(node: XmlNode | undefined, deck: Deck, placeholder?: Paint): Paint | undefined {
  for (const child of node?.children ?? []) {
    let paint: Paint | undefined
    switch (child.name) {
      case 'a:srgbClr':
        paint = fromHex(child.attributes.val)
        break
      case 'a:sysClr':
        paint = fromHex(child.attributes.lastClr ?? (child.attributes.val === 'window' ? 'FFFFFF' : '000000'))
        break
      case 'a:prstClr':
        paint = fromHex(PRESET_COLOURS[child.attributes.val ?? ''])
        break
      case 'a:scrgbClr': {
        const part = (name: string) => (Number(child.attributes[name]) / 100_000) * 255 || 0
        paint = { red: part('r'), green: part('g'), blue: part('b'), opacity: 1 }
        break
      }
      case 'a:schemeClr': {
        const name = child.attributes.val ?? ''
        paint = name === 'phClr' ? placeholder : deck.theme.colours[deck.colourMap[name] ?? name]
        break
      }
    }
    if (paint) return modified(paint, child.children)
  }
  return undefined
}

// Fills and lines

const FILLS = new Set(['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill'])

/** The fill an element of properties gives, when it gives one. */
async function fillOf(properties: XmlNode | undefined, deck: Deck, part: Part, placeholder?: Paint): Promise<Fill | undefined> {
  const fill = properties?.children.find((child) => FILLS.has(child.name))
  if (!fill) return undefined
  switch (fill.name) {
    case 'a:noFill':
      return { kind: 'none' }
    case 'a:solidFill': {
      const paint = paintOf(fill, deck, placeholder)
      return paint ? { kind: 'paint', paint } : undefined
    }
    case 'a:pattFill': {
      const paint = paintOf(childAt(fill, 'a:fgClr'), deck, placeholder)
      return paint ? { kind: 'paint', paint } : undefined
    }
    case 'a:gradFill': {
      const stops = childrenNamed(childAt(fill, 'a:gsLst'), 'a:gs')
        .map((stop) => ({ offset: (Number(stop.attributes.pos) || 0) / 100_000, paint: paintOf(stop, deck, placeholder) }))
        .filter((stop): stop is { offset: number; paint: Paint } => stop.paint !== undefined)
        .sort((one, other) => one.offset - other.offset)
      if (stops.length === 0) return undefined
      return { kind: 'gradient', stops, angle: (Number(childAt(fill, 'a:lin')?.attributes.ang) || 0) / 60_000, radial: childAt(fill, 'a:path') !== undefined }
    }
    default: {
      const href = await pictureAddress(childAt(fill, 'a:blip')?.attributes['r:embed'], deck, part)
      if (!href) return undefined
      const crop = childAt(fill, 'a:srcRect')?.attributes
      const side = (value: string | undefined) => (Number(value) || 0) / 100_000
      return { kind: 'picture', href, crop: crop && { left: side(crop.l), top: side(crop.t), right: side(crop.r), bottom: side(crop.b) } }
    }
  }
}

/** A picture of the presentation as an address of data the SVG holds: as it is, or drawn when it is a metafile. */
async function pictureAddress(id: string | undefined, deck: Deck, part: Part): Promise<string | undefined> {
  const path = id === undefined ? undefined : part.targets.get(id)
  const read = path === undefined ? undefined : partOf(deck.archive, path)
  const bytes = read ? await read().catch(() => undefined) : undefined
  if (!bytes || deck.pictureBytes + bytes.length > PICTURE_LIMIT) return undefined
  const type = pictureType(bytes)
  if (type) {
    deck.pictureBytes += bytes.length
    return `data:${type};base64,${base64(bytes)}`
  }
  const drawn = drawMetafile(bytes)
  if (!drawn || deck.pictureBytes + drawn.svg.length > PICTURE_LIMIT) return undefined
  deck.pictureBytes += drawn.svg.length
  return `data:image/svg+xml;base64,${base64(drawn.svg)}`
}

const DASHES: Record<string, number[]> = {
  dash: [4, 3],
  sysDash: [3, 1],
  dot: [1, 1],
  sysDot: [1, 1],
  dashDot: [4, 3, 1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDashDot: [3, 1, 1, 1]
}

/** The outline an element of line (`a:ln`) gives, over the one its style gives. */
function outlineOf(line: XmlNode | undefined, deck: Deck, base: Outline | undefined, placeholder?: Paint): Outline | undefined {
  if (!line) return base
  const width = line.attributes.w !== undefined ? Math.max(pixels(line.attributes.w), 0.5) : (base?.width ?? 0.75)
  const dash = childAt(line, 'a:prstDash')?.attributes.val
  const dashes = dash && DASHES[dash] ? DASHES[dash].map((part) => number(part * width)).join(' ') : base?.dashes
  if (childAt(line, 'a:noFill')) return { paint: undefined, width, dashes }
  const solid = childAt(line, 'a:solidFill') ?? childAt(line, 'a:gradFill', 'a:gsLst', 'a:gs')
  const paint = solid ? paintOf(solid, deck, placeholder) : base?.paint
  return { paint, width, dashes }
}

// Text

type Bullet =
  | { kind: 'none' }
  | { kind: 'character'; character: string; paint?: Paint | undefined }
  | { kind: 'number'; scheme: string; start: number; paint?: Paint | undefined }

interface ParagraphStyle {
  align?: string | undefined
  marginLeft?: number | undefined
  indent?: number | undefined
  bullet?: Bullet | undefined
  lineSpacing?: number | undefined
  lineHeight?: number | undefined
  spaceBefore?: number | undefined
  spaceAfter?: number | undefined
  run: RunStyle
}

const defined = <Value extends object>(value: Value): Partial<Value> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<Value>

const flag = (value: string | undefined) => (value === undefined ? undefined : value === '1' || value === 'true')

/** A run's properties (`a:rPr`, `a:defRPr`): its size in points, its weight, slant, lines, case, colour and font. */
function runStyle(properties: XmlNode | undefined, deck: Deck): RunStyle {
  if (!properties) return {}
  const { attributes } = properties
  const size = Number(attributes.sz)
  const underline = attributes.u
  const strike = attributes.strike
  const font = childAt(properties, 'a:latin')?.attributes.typeface
  return defined({
    size: Number.isFinite(size) && size > 0 ? size / 100 : undefined,
    bold: flag(attributes.b),
    italic: flag(attributes.i),
    underline: underline === undefined ? undefined : underline !== 'none',
    strike: strike === undefined ? undefined : strike !== 'noStrike',
    caps: attributes.cap === undefined ? undefined : attributes.cap === 'all',
    paint: paintOf(childAt(properties, 'a:solidFill'), deck),
    font
  })
}

/** A paragraph's properties (`a:pPr`, `a:lvl1pPr`…): its alignment, indents, bullet, spacing and its runs' default. */
function paragraphStyle(properties: XmlNode | undefined, deck: Deck): ParagraphStyle {
  if (!properties) return { run: {} }
  const { attributes } = properties
  let bullet: Bullet | undefined
  const bulletPaint = paintOf(childAt(properties, 'a:buClr'), deck)
  if (childAt(properties, 'a:buNone')) bullet = { kind: 'none' }
  else if (childAt(properties, 'a:buChar')) {
    const character = childAt(properties, 'a:buChar')?.attributes.char ?? '•'
    bullet = { kind: 'character', character: bulletCharacter(character), paint: bulletPaint }
  } else if (childAt(properties, 'a:buAutoNum')) {
    const numbering = childAt(properties, 'a:buAutoNum')?.attributes ?? {}
    bullet = { kind: 'number', scheme: numbering.type ?? 'arabicPeriod', start: Number(numbering.startAt) || 1, paint: bulletPaint }
  }
  const spacing = (name: string) => {
    const found = childAt(properties, name)
    const percent = Number(childAt(found, 'a:spcPct')?.attributes.val)
    const points = Number(childAt(found, 'a:spcPts')?.attributes.val)
    return { percent: Number.isFinite(percent) ? percent / 100_000 : undefined, points: Number.isFinite(points) ? points / 100 : undefined }
  }
  const line = spacing('a:lnSpc')
  return {
    ...defined({
      align: attributes.algn,
      marginLeft: attributes.marL === undefined ? undefined : pixels(attributes.marL),
      indent: attributes.indent === undefined ? undefined : pixels(attributes.indent),
      bullet,
      lineSpacing: line.percent,
      lineHeight: line.points,
      spaceBefore: spacing('a:spcBef').points,
      spaceAfter: spacing('a:spcAft').points
    }),
    run: runStyle(childAt(properties, 'a:defRPr'), deck)
  }
}

const mergeParagraph = (under: ParagraphStyle, over: ParagraphStyle): ParagraphStyle => ({
  ...under,
  ...defined(over),
  run: { ...under.run, ...defined(over.run) }
})

/**
 * The text of a shape (`p:txBody`) as a frame: its paragraphs with their styles over those the levels give (`levels`,
 * from the master's down to its placeholder's), each bullet or number, each run in its font, size and colour. The
 * colour its style gives (`defaults.over`) comes over the levels' and under the shape's own.
 */
function textFrame(
  body: XmlNode,
  levels: readonly (XmlNode | undefined)[],
  deck: Deck,
  defaults: { paint: Paint | undefined; font: string; over?: Paint | undefined },
  inherited: Record<string, string>
): TextFrame {
  const bodyProperties = { ...inherited, ...(childAt(body, 'a:bodyPr')?.attributes ?? {}) }
  const autofit = childAt(body, 'a:bodyPr', 'a:normAutofit')?.attributes
  const scale = (Number(autofit?.fontScale) || 100_000) / 100_000
  const reduction = (Number(autofit?.lnSpcReduction) || 0) / 100_000
  const inset = (name: string, fallback: number) => pixels(bodyProperties[name], fallback)
  const counters = new Map<number, number>()
  const paragraphs: TextParagraph[] = []
  for (const paragraph of childrenNamed(body, 'a:p')) {
    const own = childAt(paragraph, 'a:pPr')
    const level = Math.min(Math.max(Number(own?.attributes.lvl) || 0, 0), 8)
    let style: ParagraphStyle = { run: {} }
    for (const list of levels) style = mergeParagraph(style, paragraphStyle(childAt(list, `a:lvl${level + 1}pPr`), deck))
    if (defaults.over) style = { ...style, run: { ...style.run, paint: defaults.over } }
    style = mergeParagraph(style, paragraphStyle(childAt(childAt(body, 'a:lstStyle'), `a:lvl${level + 1}pPr`), deck))
    style = mergeParagraph(style, paragraphStyle(own, deck))
    const pieces: TextPiece[] = []
    let firstSize: number | undefined
    for (const part of paragraph.children) {
      if (part.name === 'a:br') pieces.push('break')
      if (part.name !== 'a:r' && part.name !== 'a:fld') continue
      const run: RunStyle = { ...style.run, ...defined(runStyle(childAt(part, 'a:rPr'), deck)) }
      const text = textIn(childAt(part, 'a:t') ?? { name: '', attributes: {}, children: [], text: '' })
      if (text === '') continue
      firstSize ??= run.size
      pieces.push({ text, style: runLook(run, deck, scale) })
    }
    const size = (firstSize ?? style.run.size ?? runStyle(childAt(paragraph, 'a:endParaRPr'), deck).size ?? 18) * scale
    let bullet: TextBullet | undefined
    if (pieces.length > 0 && style.bullet && style.bullet.kind !== 'none') {
      const count = (counters.get(level) ?? (style.bullet.kind === 'number' ? style.bullet.start : 1) - 1) + 1
      counters.set(level, count)
      for (const deeper of [...counters.keys()]) if (deeper > level) counters.delete(deeper)
      bullet = {
        mark: style.bullet.kind === 'character' ? style.bullet.character : listNumber(style.bullet.scheme, count),
        paint: style.bullet.paint ?? style.run.paint ?? defaults.paint,
        width: style.indent !== undefined && style.indent < 0 ? -style.indent : undefined
      }
    } else counters.delete(level)
    paragraphs.push({
      align: style.align === 'ctr' ? 'center' : style.align === 'r' ? 'right' : style.align === 'just' || style.align === 'dist' ? 'justify' : 'left',
      size,
      lineHeight: style.lineHeight,
      lineSpacing: style.lineHeight !== undefined ? undefined : Math.max(0.5, (style.lineSpacing ?? 1) - reduction),
      marginLeft: style.marginLeft,
      indent: style.indent,
      spaceBefore: style.spaceBefore,
      spaceAfter: style.spaceAfter,
      bullet,
      pieces
    })
  }
  return {
    paragraphs,
    insets: { top: inset('tIns', 4.8), right: inset('rIns', 9.6), bottom: inset('bIns', 4.8), left: inset('lIns', 9.6) },
    anchor: bodyProperties.anchor === 'ctr' ? 'middle' : bodyProperties.anchor === 'b' ? 'bottom' : 'top',
    wraps: bodyProperties.wrap !== 'none',
    font: defaults.font,
    paint: defaults.paint
  }
}

/** A run's style as it is drawn: its size scaled to fit its box, its font the theme's when it names one. */
function runLook(run: RunStyle, deck: Deck, scale: number): RunStyle {
  const font = run.font === '+mj-lt' ? deck.theme.major : run.font === '+mn-lt' ? deck.theme.minor : run.font
  return { ...run, size: run.size === undefined ? undefined : run.size * scale, font: font && !font.startsWith('+') ? font : undefined }
}

// Geometry

function boxOf(transform: XmlNode | undefined): Box | undefined {
  const offset = childAt(transform, 'a:off')?.attributes
  const extent = childAt(transform, 'a:ext')?.attributes
  if (!transform || !offset || !extent) return undefined
  return {
    x: pixels(offset.x),
    y: pixels(offset.y),
    width: pixels(extent.cx),
    height: pixels(extent.cy),
    rotation: (Number(transform.attributes.rot) || 0) / 60_000,
    flipH: transform.attributes.flipH === '1',
    flipV: transform.attributes.flipV === '1'
  }
}

/** An adjustment of a preset shape, from 0 to 1 of its reference, or the fallback. */
const adjustment = (geometry: XmlNode | undefined, name: string, fallback: number) => {
  const guide = childrenNamed(childAt(geometry, 'a:avLst'), 'a:gd').find((one) => one.attributes.name === name)
  const value = Number(/^val\s+(-?\d+)/.exec(guide?.attributes.fmla ?? '')?.[1])
  return (Number.isFinite(value) ? value : fallback) / 100_000
}

/** A shape's outline as SVG path data in its own box: its own paths, or one of the common kinds with its adjustments. */
function geometryPath(properties: XmlNode | undefined, width: number, height: number): ShapePath {
  const custom = childAt(properties, 'a:custGeom')
  if (custom) return customPath(custom, width, height)
  const preset = childAt(properties, 'a:prstGeom')
  return presetPath(preset?.attributes.prst ?? 'rect', width, height, (name, fallback) => adjustment(preset, name, fallback * 100_000))
}

/** A shape drawn by its own paths (`a:custGeom`), each in a box of its own scaled to the shape's. */
function customPath(geometry: XmlNode, width: number, height: number): ShapePath {
  let data = ''
  let closed = false
  for (const path of childrenNamed(childAt(geometry, 'a:pathLst'), 'a:path')) {
    const scaleX = width / (Number(path.attributes.w) || width || 1)
    const scaleY = height / (Number(path.attributes.h) || height || 1)
    const point = (node: XmlNode | undefined): [number, number] => [(Number(node?.attributes.x) || 0) * scaleX, (Number(node?.attributes.y) || 0) * scaleY]
    let current: [number, number] = [0, 0]
    for (const step of path.children) {
      const points = childrenNamed(step, 'a:pt').map(point)
      if (step.name === 'a:moveTo' && points[0]) {
        current = points[0]
        data += `M${number(current[0])} ${number(current[1])}`
      } else if (step.name === 'a:lnTo' && points[0]) {
        current = points[0]
        data += `L${number(current[0])} ${number(current[1])}`
      } else if (step.name === 'a:cubicBezTo' && points.length === 3) {
        current = points[2] as [number, number]
        data += `C${points.map(([x, y]) => `${number(x)} ${number(y)}`).join(' ')}`
      } else if (step.name === 'a:quadBezTo' && points.length === 2) {
        current = points[1] as [number, number]
        data += `Q${points.map(([x, y]) => `${number(x)} ${number(y)}`).join(' ')}`
      } else if (step.name === 'a:arcTo') {
        // An arc goes on from where the path is, along an ellipse whose angle there is its start.
        const radiusX = (Number(step.attributes.wR) || 0) * scaleX
        const radiusY = (Number(step.attributes.hR) || 0) * scaleY
        const start = ((Number(step.attributes.stAng) || 0) / 60_000) * (Math.PI / 180)
        const sweep = ((Number(step.attributes.swAng) || 0) / 60_000) * (Math.PI / 180)
        const centreX = current[0] - radiusX * Math.cos(start)
        const centreY = current[1] - radiusY * Math.sin(start)
        current = [centreX + radiusX * Math.cos(start + sweep), centreY + radiusY * Math.sin(start + sweep)]
        data += `A${number(radiusX)} ${number(radiusY)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${number(current[0])} ${number(current[1])}`
      } else if (step.name === 'a:close') {
        data += 'Z'
        closed = true
      }
    }
    if (path.attributes.fill !== 'none') closed = closed || data.includes('Z')
  }
  return data ? { data, closed } : { ...rectanglePath(width, height), closed }
}

// Drawing

/** Where a placeholder sits on a slide: its kind and its number, as a layout and a master know it. */
interface Placeholder {
  type: string
  index: string | undefined
}

const NON_VISUAL = ['p:nvSpPr', 'p:nvPicPr', 'p:nvGraphicFramePr', 'p:nvGrpSpPr', 'p:nvCxnSpPr']

function placeholderOf(shape: XmlNode): Placeholder | undefined {
  for (const name of NON_VISUAL) {
    const found = childAt(shape, name, 'p:nvPr', 'p:ph')
    if (found) return { type: found.attributes.type ?? 'body', index: found.attributes.idx }
  }
  return undefined
}

/** The kind a master's placeholder answers to, for a layout's: a centred title is a title, a subtitle a body. */
const masterKind = (type: string) => (type === 'ctrTitle' ? 'title' : type === 'subTitle' || type === 'obj' ? 'body' : type)

/** A layout's or master's placeholder for a slide's: the same number first, then the same kind. */
function matching(part: Part | undefined, wanted: Placeholder, byKindOnly: boolean): XmlNode | undefined {
  const tree = childAt(part?.tree, part?.tree.children.find((child) => child.name !== '#text')?.name ?? '', 'p:cSld', 'p:spTree')
  const shapes = tree?.children.filter((child) => child.name !== '#text') ?? []
  const withPlaceholders = shapes.map((shape) => ({ shape, placeholder: placeholderOf(shape) })).filter((one) => one.placeholder)
  if (!byKindOnly && wanted.index !== undefined) {
    const found = withPlaceholders.find((one) => one.placeholder?.index === wanted.index)
    if (found) return found.shape
  }
  const kind = byKindOnly ? masterKind(wanted.type) : wanted.type
  return (
    withPlaceholders.find((one) => (byKindOnly ? masterKind(one.placeholder?.type ?? '') : one.placeholder?.type) === kind)?.shape ??
    (byKindOnly ? undefined : withPlaceholders.find((one) => masterKind(one.placeholder?.type ?? '') === masterKind(kind))?.shape)
  )
}

/** The master's style of text for a placeholder of a kind: titles', bodies', or any other text's. */
function masterTextStyle(deck: Deck, placeholder: Placeholder | undefined): XmlNode | undefined {
  const styles = childAt(deck.master.tree, 'p:sldMaster', 'p:txStyles')
  if (!placeholder) return childAt(styles, 'p:otherStyle')
  const kind = masterKind(placeholder.type)
  return kind === 'title' ? childAt(styles, 'p:titleStyle') : kind === 'body' ? childAt(styles, 'p:bodyStyle') : childAt(styles, 'p:otherStyle')
}

/** What a shape draws itself with: its properties, those its layout's and master's placeholders give. */
interface Inherited {
  layout: XmlNode | undefined
  master: XmlNode | undefined
}

function inheritedOf(deck: Deck, part: Part, placeholder: Placeholder | undefined): Inherited {
  if (!placeholder || part === deck.master) return { layout: undefined, master: undefined }
  if (part === deck.layout) return { layout: undefined, master: matching(deck.master, placeholder, true) }
  const layout = matching(deck.layout, placeholder, false)
  const layoutPlaceholder = layout ? placeholderOf(layout) : placeholder
  return { layout, master: matching(deck.master, layoutPlaceholder ?? placeholder, true) }
}

const propertiesOf = (shape: XmlNode | undefined) => childAt(shape, 'p:spPr') ?? childAt(shape, 'p:grpSpPr')

/** The style a shape refers to (`p:style`): its colours of fill, line and font, and the theme's fill and line of each number. */
async function styled(shape: XmlNode, deck: Deck, part: Part): Promise<{ fill: Fill | undefined; outline: Outline | undefined; font: Paint | undefined }> {
  const style = childAt(shape, 'p:style')
  if (!style) return { fill: undefined, outline: undefined, font: undefined }
  const reference = (name: string) => childAt(style, name)
  const fillReference = reference('a:fillRef')
  const lineReference = reference('a:lnRef')
  const fillIndex = Number(fillReference?.attributes.idx) || 0
  const lineIndex = Number(lineReference?.attributes.idx) || 0
  const fillPaint = paintOf(fillReference, deck)
  const linePaint = paintOf(lineReference, deck)
  const themeFill = fillIndex >= 1001 ? deck.theme.backgrounds[fillIndex - 1001] : deck.theme.fills[fillIndex - 1]
  const fill =
    fillIndex === 0
      ? undefined
      : themeFill
        ? await fillOf({ name: '', attributes: {}, children: [themeFill], text: '' }, deck, part, fillPaint)
        : fillPaint && { kind: 'paint' as const, paint: fillPaint }
  const themeLine = deck.theme.lines[lineIndex - 1]
  const outline = lineIndex === 0 ? undefined : outlineOf(themeLine, deck, { paint: linePaint, width: 0.75, dashes: undefined }, linePaint)
  return { fill, outline, font: paintOf(reference('a:fontRef'), deck) }
}

/**
 * A table of a slide (`a:tbl`) as XHTML in its frame: its columns at their widths, its rows at their heights, merged
 * cells as one, each cell's fill and text; a table of the default style gets its first row and its banded rows.
 */
function tableHtml(table: XmlNode, box: { width: number; height: number }, deck: Deck, levels: readonly (XmlNode | undefined)[]): Promise<string> {
  return (async () => {
    const properties = childAt(table, 'a:tblPr')?.attributes ?? {}
    const columns = childrenNamed(childAt(table, 'a:tblGrid'), 'a:gridCol').map((column) => pixels(column.attributes.w))
    const accent = deck.theme.colours.accent1 ?? { red: 68, green: 114, blue: 196, opacity: 1 }
    const rows: string[] = []
    childrenNamed(table, 'a:tr').forEach((row, rowIndex) => {
      const cells: string[] = []
      const header = properties.firstRow === '1' && rowIndex === 0
      const banded = properties.bandRow === '1' && !header && (rowIndex - (properties.firstRow === '1' ? 1 : 0)) % 2 === 0
      for (const cell of childrenNamed(row, 'a:tc')) {
        if (cell.attributes.hMerge === '1' || cell.attributes.vMerge === '1') continue
        const cellProperties = childAt(cell, 'a:tcPr')
        const own = cellProperties?.children.find((child) => FILLS.has(child.name))
        const paint = own?.name === 'a:solidFill' ? paintOf(own, deck) : undefined
        const ground =
          own?.name === 'a:noFill'
            ? undefined
            : (paint ??
              (header
                ? accent
                : banded
                  ? modified(accent, [{ name: 'a:tint', attributes: { val: '40000' }, children: [], text: '' }])
                  : modified(accent, [{ name: 'a:tint', attributes: { val: '20000' }, children: [], text: '' }])))
        const body = childAt(cell, 'a:txBody')
        const text = body
          ? textDiv(
              textFrame(
                body,
                levels,
                deck,
                { paint: undefined, font: deck.theme.minor, over: header ? { red: 255, green: 255, blue: 255, opacity: 1 } : undefined },
                {}
              )
            )
          : ''
        const span = Number(cell.attributes.gridSpan) > 1 ? ` colspan="${Number(cell.attributes.gridSpan)}"` : ''
        const rowSpan = Number(cell.attributes.rowSpan) > 1 ? ` rowspan="${Number(cell.attributes.rowSpan)}"` : ''
        cells.push(
          `<td${span}${rowSpan} style="padding:0;border:1px solid #ffffff;vertical-align:top;${ground ? `background:${css(ground)};` : ''}${header ? 'font-weight:bold;' : ''}">${text}</td>`
        )
      }
      rows.push(`<tr style="height:${number(pixels(row.attributes.h))}px">${cells.join('')}</tr>`)
    })
    const widths = columns.map((width) => `<col style="width:${number(width)}px"/>`).join('')
    return `<foreignObject x="0" y="0" width="${number(box.width)}" height="${number(box.height)}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml"><table style="border-collapse:collapse;table-layout:fixed;width:${number(box.width)}px"><colgroup>${widths}</colgroup>${rows.join('')}</table></div></foreignObject>`
  })()
}

interface Drawing {
  canvas: Canvas
  shapes: number
}

/** The shapes of a tree of a part (`p:spTree`, a group), drawn in order; a layout's and master's placeholders left out. */
async function drawShapes(tree: XmlNode | undefined, deck: Deck, part: Part, drawing: Drawing, depth: number): Promise<void> {
  for (const shape of tree?.children ?? []) {
    if (drawing.shapes >= SHAPE_LIMIT) return
    if (!['p:sp', 'p:pic', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp', 'mc:AlternateContent'].includes(shape.name)) continue
    // What a newer app keeps for itself is drawn from the choice older apps would make.
    if (shape.name === 'mc:AlternateContent') {
      await drawShapes(childAt(shape, 'mc:Fallback'), deck, part, drawing, depth)
      continue
    }
    const placeholder = placeholderOf(shape)
    if (placeholder && part !== deck.slide) continue
    drawing.shapes++
    try {
      await drawShape(shape, placeholder, deck, part, drawing, depth)
    } catch {
      // A shape that cannot be drawn is left out of the drawing.
    }
  }
}

async function drawShape(shape: XmlNode, placeholder: Placeholder | undefined, deck: Deck, part: Part, drawing: Drawing, depth: number): Promise<void> {
  const { canvas } = drawing
  const inherited = inheritedOf(deck, part, placeholder)
  if (shape.name === 'p:grpSp') {
    if (depth >= GROUP_DEPTH_LIMIT) return
    const transform = childAt(shape, 'p:grpSpPr', 'a:xfrm')
    const box = boxOf(transform)
    const childOffset = childAt(transform, 'a:chOff')?.attributes
    const childExtent = childAt(transform, 'a:chExt')?.attributes
    if (!box) return drawShapes(shape, deck, part, drawing, depth + 1)
    const scaleX = box.width / (pixels(childExtent?.cx) || box.width || 1)
    const scaleY = box.height / (pixels(childExtent?.cy) || box.height || 1)
    canvas.parts.push(
      `<g transform="${placed(box)} scale(${number(scaleX)} ${number(scaleY)}) translate(${number(-pixels(childOffset?.x))} ${number(-pixels(childOffset?.y))})">`
    )
    await drawShapes(shape, deck, part, drawing, depth + 1)
    canvas.parts.push('</g>')
    return
  }
  const transformOf = (node: XmlNode | undefined) => childAt(node, 'p:spPr', 'a:xfrm') ?? childAt(node, 'p:xfrm')
  const box = boxOf(transformOf(shape) ?? transformOf(inherited.layout) ?? transformOf(inherited.master))
  if (!box || box.width < 0 || box.height < 0) return
  const size = { width: box.width, height: box.height }
  const content: string[] = []

  if (shape.name === 'p:graphicFrame') {
    const data = childAt(shape, 'a:graphic', 'a:graphicData')
    const table = childAt(data, 'a:tbl')
    if (table)
      content.push(await tableHtml(table, size, deck, [childAt(deck.defaultText, 'p:defaultTextStyle') ?? deck.defaultText, masterTextStyle(deck, undefined)]))
    const chartId = childAt(data, 'c:chart')?.attributes['r:id']
    const chartPart = chartId === undefined ? undefined : part.targets.get(chartId)
    if (chartPart) {
      const chart = await deck.chart(chartPart)
      if (chart)
        content.push(
          chartElements(chart, size, {
            tones: ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((name) =>
              css(deck.theme.colours[name] ?? { red: 68, green: 114, blue: 196, opacity: 1 })
            ),
            font: deck.theme.minor
          })
        )
    }
    const model = childAt(data, 'dgm:relIds')?.attributes['r:dm']
    if (model) content.push(await smartArt(model, deck, part, drawing, depth))
  } else if (shape.name === 'p:pic') {
    const fill = await fillOf(
      childAt(shape, 'p:blipFill') && { name: '', attributes: {}, children: [{ ...(childAt(shape, 'p:blipFill') as XmlNode), name: 'a:blipFill' }], text: '' },
      deck,
      part
    )
    if (fill?.kind === 'picture') content.push(pictureElement(fill.href, fill.crop, size))
    const outline = outlineOf(childAt(shape, 'p:spPr', 'a:ln'), deck, undefined)
    if (outline?.paint)
      content.push(`<path d="${geometryPath(childAt(shape, 'p:spPr'), size.width, size.height).data}" fill="none" ${strokeAttributes(outline)}/>`)
  } else {
    const properties = propertiesOf(shape)
    const style = await styled(shape, deck, part)
    const fill =
      (await fillOf(properties, deck, part)) ??
      (await fillOf(propertiesOf(inherited.layout), deck, part)) ??
      (await fillOf(propertiesOf(inherited.master), deck, part)) ??
      style.fill
    const outline = outlineOf(childAt(properties, 'a:ln'), deck, outlineOf(childAt(propertiesOf(inherited.layout), 'a:ln'), deck, style.outline))
    const geometry = geometryPath(
      childAt(properties, 'a:prstGeom') || childAt(properties, 'a:custGeom') ? properties : (propertiesOf(inherited.layout) ?? properties),
      size.width,
      size.height
    )
    const drawnShape = shapeElement(geometry, fill, outline, canvas, size)
    if (drawnShape) content.push(drawnShape)
    const body = childAt(shape, 'p:txBody')
    if (body && childrenNamed(body, 'a:p').some((paragraph) => paragraph.children.some((child) => child.name === 'a:r' || child.name === 'a:fld'))) {
      const levels = [
        placeholder ? undefined : (childAt(deck.defaultText, 'p:defaultTextStyle') ?? deck.defaultText),
        masterTextStyle(deck, placeholder),
        childAt(inherited.master, 'p:txBody', 'a:lstStyle'),
        childAt(inherited.layout, 'p:txBody', 'a:lstStyle')
      ]
      const bodyProperties = {
        ...(childAt(inherited.master, 'p:txBody', 'a:bodyPr')?.attributes ?? {}),
        ...(childAt(inherited.layout, 'p:txBody', 'a:bodyPr')?.attributes ?? {})
      }
      const font = placeholder && masterKind(placeholder.type) === 'title' ? deck.theme.major : deck.theme.minor
      const textBox = boxOf(childAt(shape, 'p:txXfrm'))
      const text = textHtml(
        textFrame(body, levels, deck, { paint: style.font ?? deck.theme.colours[deck.colourMap.tx1 ?? 'dk1'], font, over: style.font }, bodyProperties),
        textBox ? { width: textBox.width, height: textBox.height } : size
      )
      content.push(textBox ? `<g transform="translate(${number(textBox.x - box.x)} ${number(textBox.y - box.y)})">${text}</g>` : text)
    }
  }
  if (content.length > 0) canvas.parts.push(`<g transform="${placed(box)}">${content.join('')}</g>`)
}

/** A SmartArt's shapes, as PowerPoint last drew them, from the drawing its data names: in the frame's own place. */
async function smartArt(model: string, deck: Deck, part: Part, drawing: Drawing, depth: number): Promise<string> {
  const data = await readPart(deck.archive, part.targets.get(model))
  const drawingId = findAttribute(data?.tree, 'dsp:dataModelExt', 'relId')
  const drawn = await readPart(deck.archive, drawingId === undefined ? undefined : part.targets.get(drawingId))
  const tree = renamed(childAt(drawn?.tree, 'dsp:drawing', 'dsp:spTree'))
  if (!tree || !drawn) return ''
  const inner: Drawing = { canvas: new Canvas(), shapes: drawing.shapes }
  await drawShapes(tree, deck, { ...drawn, tree }, inner, depth + 1)
  drawing.shapes = inner.shapes
  drawing.canvas.definitions.push(...inner.canvas.definitions)
  // The frame's own place is where the drawing's shapes are measured from.
  return `<g transform="translate(0 0)">${inner.canvas.parts.join('')}</g>`
}

const findAttribute = (node: XmlNode | undefined, name: string, attribute: string): string | undefined => {
  if (!node) return undefined
  if (node.name === name) return node.attributes[attribute]
  for (const child of node.children) {
    const found = findAttribute(child, name, attribute)
    if (found !== undefined) return found
  }
  return undefined
}

/** A SmartArt drawing's elements under the names a slide gives them. */
function renamed(node: XmlNode | undefined): XmlNode | undefined {
  if (!node) return undefined
  return { ...node, name: node.name.replace(/^dsp:/, 'p:'), children: node.children.map((child) => renamed(child) as XmlNode) }
}

/** A slide's background: its own, its layout's or its master's, a fill of its own or the theme's of a number. */
async function background(deck: Deck): Promise<Fill | undefined> {
  for (const part of [deck.slide, deck.layout, deck.master]) {
    const root = part?.tree.children.find((child) => child.name !== '#text')
    const found = childAt(root, 'p:cSld', 'p:bg')
    if (!found || !part) continue
    const own = childAt(found, 'p:bgPr')
    if (own) return fillOf(own, deck, part)
    const reference = childAt(found, 'p:bgRef')
    const index = Number(reference?.attributes.idx) || 0
    const paint = paintOf(reference, deck)
    const themed = index >= 1001 ? deck.theme.backgrounds[index - 1001] : deck.theme.fills[index - 1]
    if (themed) return fillOf({ name: '', attributes: {}, children: [themed], text: '' }, deck, part, paint)
    return paint ? { kind: 'paint', paint } : undefined
  }
  return undefined
}

/**
 * A slide of a presentation drawn as SVG, at the size of the presentation's slides (in English Metric Units), its
 * charts read by `chart`; none when its parts cannot be found.
 */
export async function drawSlide(
  archive: Archive,
  slidePath: string,
  slideSize: { width: number; height: number },
  options: { chart?: (part: string) => Promise<OfficeChart | undefined>; defaultText?: XmlNode | undefined } = {}
): Promise<DrawnSlide | undefined> {
  const slide = await readPart(archive, slidePath)
  const layoutPath = [...(slide?.targets.values() ?? [])].find((target) => /slideLayouts\/[^/]+\.xml$/i.test(target))
  const layout = await readPart(archive, layoutPath)
  const masterPath = [...(layout?.targets.values() ?? [])].find((target) => /slideMasters\/[^/]+\.xml$/i.test(target))
  const master = await readPart(archive, masterPath)
  if (!slide || !master) return undefined
  const themePath = [...master.targets.values()].find((target) => /theme\/[^/]+\.xml$/i.test(target))
  const theme = readTheme((await readPart(archive, themePath))?.tree)
  const overriding = (part: Part | undefined) =>
    childAt(
      part?.tree.children.find((child) => child.name !== '#text'),
      'p:clrMapOvr',
      'a:overrideClrMapping'
    )?.attributes
  const colourMap = overriding(slide) ?? overriding(layout) ?? childAt(master.tree, 'p:sldMaster', 'p:clrMap')?.attributes ?? {}
  const deck: Deck = {
    archive,
    theme,
    colourMap,
    master,
    layout,
    slide,
    defaultText: options.defaultText,
    chart: options.chart ?? (async () => undefined),
    pictureBytes: 0
  }
  const width = slideSize.width / EMU_PER_PIXEL
  const height = slideSize.height / EMU_PER_PIXEL
  const drawing: Drawing = { canvas: new Canvas(), shapes: 0 }
  const ground = await background(deck)
  drawing.canvas.parts.push(
    `<rect width="${number(width)}" height="${number(height)}" ${ground && ground.kind !== 'none' ? fillAttribute(ground, drawing.canvas, { width, height }) : 'fill="#ffffff"'}/>`
  )
  const showsMaster = (part: Part | undefined) => part?.tree.children.find((child) => child.name !== '#text')?.attributes.showMasterSp !== '0'
  const treeOf = (part: Part | undefined) =>
    childAt(
      part?.tree.children.find((child) => child.name !== '#text'),
      'p:cSld',
      'p:spTree'
    )
  if (showsMaster(slide) && showsMaster(layout)) await drawShapes(treeOf(master), deck, master, drawing, 0)
  if (showsMaster(slide) && layout) await drawShapes(treeOf(layout), deck, layout, drawing, 0)
  await drawShapes(treeOf(slide), deck, slide, drawing, 0)
  return slideSvg(width, height, drawing.canvas)
}
