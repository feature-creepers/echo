/**
 * A Word document of 2007 or later as it looks (docs/SPEC.md, section 9.7), read into `document-look.ts`: each
 * paragraph and run in the fold of what sets it, from the most general to its own (the document's defaults, the table's
 * style, the paragraph's style and those it is based on, the list's level, the character style, the run's own), with
 * colours and fonts from the theme; lists numbered as their levels say; tables with their grid, merged cells, borders
 * and shading, their style's look for the first row, the last, the first column, the last and the bands where the table
 * says to use them; sections with their page size, margins, columns, headers and footers; footnotes at the foot of the
 * page that names them and endnotes at the end. Pages break where the document breaks them and where Word last broke
 * them when it laid the document out (`w:lastRenderedPageBreak`), so a document Word saved shows its pages as Word did.
 */

import { type Archive, relationships, textOf } from './archive.ts'
import {
  type BorderLook,
  colorOf,
  type DocumentBlock,
  type DocumentLook,
  type DocumentPage,
  type DocumentParagraph,
  type DocumentSpan,
  type DocumentTable,
  overParagraph,
  type PageBand,
  type ParagraphLook,
  type PlacedFigure,
  type Sides,
  type TableCell,
  type TextBox,
  type TextLook
} from './document-look.ts'
import { isEquationProgram } from './equation-editor.ts'
import { emuPixels, type Figures, lengthPixels, readChart } from './office-figures.ts'
import { mathText } from './office-math.ts'
import { BLOCK_LIMIT } from './office-text.ts'
import { bulletCharacter, css, fromHex, fromLightness, toLightness } from './slide-svg.ts'
import { childAt, childrenNamed, nodeEvents, type XmlNode, xmlTree } from './xml.ts'

// Lengths

const UNIT_POINTS: Record<string, number> = { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, pc: 12, pi: 12 }

/** A length as Word writes it, in points: a number of `per` to the point, or a number with its unit ("1in", "2.5cm"). */
function length(value: string | undefined, per: number): number | undefined {
  if (value === undefined) return undefined
  const match = /^\s*(-?[\d.]+)\s*(in|cm|mm|pt|pc|pi)?\s*$/.exec(value)
  if (!match) return undefined
  const found = Number(match[1])
  if (!Number.isFinite(found)) return undefined
  return match[2] ? found * (UNIT_POINTS[match[2]] ?? 1) : found / per
}

/** A number held between two others. */
const within = (found: number, lowest: number, highest: number) => Math.min(Math.max(found, lowest), highest)

/** Twentieths of a point, Word's usual length. */
const twips = (value: string | undefined) => length(value, 20)
/** English Metric Units, DrawingML's length: 12,700 to the point. */
const emuPoints = (value: string | undefined) => length(value, 12_700)
const value = (node: XmlNode | undefined) => node?.attributes['w:val']
/** A toggle as Word writes it: on unless its value says off. */
const toggled = (node: XmlNode) => !['0', 'false', 'off', 'none'].includes(node.attributes['w:val'] ?? 'on')

// The theme

interface WordTheme {
  colors: Record<string, string>
  major: string
  minor: string
}

/** The names Word gives the theme's colours, as the theme names them, `text1` and the like through the document's map. */
const THEME_NAMES: Record<string, string> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  hyperlink: 'hlink',
  followedHyperlink: 'folHlink'
}

function readTheme(xml: string | undefined, mapping: XmlNode | undefined): WordTheme {
  const elements = childAt(xmlTree(xml ?? ''), 'a:theme', 'a:themeElements')
  const colors: Record<string, string> = {}
  for (const entry of childAt(elements, 'a:clrScheme')?.children ?? []) {
    const given = entry.children.find((child) => child.name === 'a:srgbClr' || child.name === 'a:sysClr')
    const color = colorOf(given?.name === 'a:sysClr' ? given.attributes.lastClr : given?.attributes.val)
    if (color) colors[entry.name.replace(/^a:/, '')] = color
  }
  // The document maps the colours of text and background onto the theme's darks and lights.
  const mapped = (key: string, fallback: string) => THEME_NAMES[mapping?.attributes[`w:${key}`] ?? fallback] ?? fallback
  for (const [name, key, fallback] of [
    ['text1', 't1', 'dark1'],
    ['background1', 'bg1', 'light1'],
    ['text2', 't2', 'dark2'],
    ['background2', 'bg2', 'light2']
  ] as const) {
    const color = colors[mapped(key, fallback)] ?? colors[THEME_NAMES[fallback] ?? '']
    if (color) colors[name] = color
  }
  for (const [name, scheme] of Object.entries(THEME_NAMES)) {
    const color = colors[scheme]
    if (color) colors[name] = color
  }
  const font = (kind: string) => childAt(elements, 'a:fontScheme', kind, 'a:latin')?.attributes.typeface ?? ''
  return { colors, major: font('a:majorFont'), minor: font('a:minorFont') }
}

/** A colour of the theme made darker (`shade`) or lighter (`tint`) by a byte, as Word does, through its lightness. */
function shaded(color: string, shade: string | undefined, tint: string | undefined): string {
  const paint = fromHex(color.slice(1))
  if (!paint) return color
  const [hue, saturation, lightness] = toLightness(paint)
  const byte = (given: string | undefined) => {
    const found = Number.parseInt(given ?? '', 16)
    return Number.isFinite(found) ? Math.min(255, Math.max(0, found)) / 255 : undefined
  }
  const darker = byte(shade)
  const lighter = byte(tint)
  const changed = darker !== undefined ? lightness * darker : lighter !== undefined ? lightness * lighter + (1 - lighter) : lightness
  return css(fromLightness(hue, saturation, changed, 1))
}

/** Two colours mixed, a share of the first over the second, as a pattern of dots looks from afar. */
function mixed(over: string, under: string, share: number): string {
  const one = fromHex(over.slice(1))
  const other = fromHex(under.slice(1))
  if (!one || !other) return over
  const mix = (a: number, b: number) => a * share + b * (1 - share)
  return css({ red: mix(one.red, other.red), green: mix(one.green, other.green), blue: mix(one.blue, other.blue), opacity: 1 })
}

const HIGHLIGHTS: Record<string, string> = {
  yellow: 'ffff00',
  green: '00ff00',
  cyan: '00ffff',
  magenta: 'ff00ff',
  blue: '0000ff',
  red: 'ff0000',
  darkBlue: '000080',
  darkCyan: '008080',
  darkGreen: '008000',
  darkMagenta: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  darkGray: '808080',
  lightGray: 'c0c0c0',
  black: '000000',
  white: 'ffffff'
}

const UNDERLINES: Record<string, TextLook['underline']> = {
  single: 'solid',
  words: 'solid',
  thick: 'solid',
  double: 'double',
  dotted: 'dotted',
  dottedHeavy: 'dotted',
  dash: 'dashed',
  dashedHeavy: 'dashed',
  dashLong: 'dashed',
  dashLongHeavy: 'dashed',
  dotDash: 'dashed',
  dotDotDash: 'dashed',
  wave: 'wavy',
  wavyHeavy: 'wavy',
  wavyDouble: 'wavy'
}

const SYMBOL_FONTS = /^(symbol|wingdings( 2| 3)?|webdings|zapf ?dingbats|marlett|mt extra)$/i

/** Whether a font is one of symbols, whose characters stand for others. */
export const isSymbolFont = (font: string | undefined): boolean => font !== undefined && SYMBOL_FONTS.test(font)

/** A character of a font of symbols as the one it looks like: Symbol keeps its bullet where other fonts keep a middle dot. */
export function symbolCharacter(font: string, character: string): string {
  const code = character.codePointAt(0) ?? 0
  if (/^symbol$/i.test(font)) {
    const plain = code >= 0xf020 && code <= 0xf0ff ? code - 0xf000 : code
    const known = SYMBOL_CHARACTERS[plain]
    if (known) return known
    // Symbol's letters are Greek's, in the order of the Latin ones they stand in for.
    if (plain >= 0x41 && plain <= 0x5a) return [...SYMBOL_UPPER][plain - 0x41] as string
    if (plain >= 0x61 && plain <= 0x7a) return [...SYMBOL_LOWER][plain - 0x61] as string
  }
  return bulletCharacter(character)
}

/** What Symbol's characters past its letters stand for: suits, arrows, the signs of mathematics. */
const SYMBOL_CHARACTERS: Record<number, string> = {
  163: '≤',
  165: '∞',
  167: '♣',
  168: '♦',
  169: '♥',
  170: '♠',
  171: '↔',
  172: '←',
  173: '↑',
  174: '→',
  175: '↓',
  176: '°',
  177: '±',
  179: '≥',
  180: '×',
  183: '•',
  184: '÷',
  185: '≠',
  187: '≈',
  214: '√',
  215: '⋅',
  222: '⇒',
  224: '◊',
  229: '∑',
  242: '∫'
}

/** Symbol's Greek letters, by the Latin letter each stands in for, from A to Z. */
const SYMBOL_UPPER = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'
const SYMBOL_LOWER = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'

/** A run's look while it is read: what the look keeps, and whether it is hidden. */
type RunRead = TextLook & { hidden?: boolean | undefined }

/** What every part of the document is read with. */
interface Context {
  theme: WordTheme
  styles: Map<string, XmlNode>
  defaults: { run: XmlNode | undefined; paragraph: XmlNode | undefined }
  defaultParagraph: string | undefined
  defaultTable: string | undefined
  numbering: Numbering
  tab: number
  compatibility: number
}

/** A colour an element gives: its value, else its theme's colour, shaded or tinted. `auto` gives none. */
function colorAttributes(node: XmlNode, context: Context, names = { value: 'w:color', theme: 'w:themeColor', shade: 'w:themeShade', tint: 'w:themeTint' }) {
  const theme = node.attributes[names.theme]
  const themed = theme === undefined ? undefined : context.theme.colors[theme]
  if (themed) return shaded(themed, node.attributes[names.shade], node.attributes[names.tint])
  return colorOf(node.attributes[names.value])
}

/** The colour a shading gives: its fill, its colour over it in a pattern, or none. */
function shadingOf(node: XmlNode | undefined, context: Context): string | undefined {
  if (!node) return undefined
  const pattern = node.attributes['w:val'] ?? 'clear'
  if (pattern === 'nil') return undefined
  const fill = colorAttributes(node, context, { value: 'w:fill', theme: 'w:themeFill', shade: 'w:themeFillShade', tint: 'w:themeFillTint' })
  const color = colorAttributes(node, context) ?? '#000000'
  if (pattern === 'solid') return color
  const share = /^pct(\d+)$/.exec(pattern)
  if (share) return mixed(color, fill ?? '#ffffff', Number(share[1]) / 100)
  return fill
}

/** A border as Word writes one; one of `nil` or `none` is no border, which hides one a style gives. */
function borderOf(node: XmlNode | undefined, context: Context): BorderLook | undefined {
  if (!node) return undefined
  const kind = node.attributes['w:val'] ?? 'single'
  if (kind === 'nil' || kind === 'none') return { width: 0, style: 'solid', color: '#000000' }
  const width = Math.max(0.25, (Number(node.attributes['w:sz']) || 4) / 8)
  const style = /double|triple|thinThick|thickThin/i.test(kind)
    ? 'double'
    : /dot/i.test(kind)
      ? /dash/i.test(kind)
        ? 'dashed'
        : 'dotted'
      : /dash/i.test(kind)
        ? 'dashed'
        : 'solid'
  return { width: style === 'double' ? Math.max(width * 3, 2.25) : width, style, color: colorAttributes(node, context) ?? '#000000' }
}

function sidesOf(
  node: XmlNode | undefined,
  context: Context,
  inside = false
): Sides<BorderLook> & { insideH?: BorderLook | undefined; insideV?: BorderLook | undefined } {
  const side = (...names: string[]) => borderOf(names.map((name) => childAt(node, name)).find(Boolean), context)
  const sides = { top: side('w:top'), right: side('w:right', 'w:end'), bottom: side('w:bottom'), left: side('w:left', 'w:start') }
  return inside ? { ...sides, insideH: side('w:insideH'), insideV: side('w:insideV') } : sides
}

/** What is set over what: a side given in `over` wins. */
const overSides = <Value>(under: Sides<Value>, over: Sides<Value>): Sides<Value> => ({
  top: over.top ?? under.top,
  right: over.right ?? under.right,
  bottom: over.bottom ?? under.bottom,
  left: over.left ?? under.left
})

/** A run's look with what an element of run properties sets over it. */
function runLook(properties: XmlNode | undefined, under: RunRead, context: Context): RunRead {
  if (!properties) return under
  const look: RunRead = { ...under }
  for (const child of properties.children) {
    switch (child.name) {
      case 'w:rFonts': {
        const theme = child.attributes['w:asciiTheme'] ?? child.attributes['w:hAnsiTheme']
        const themed = theme === undefined ? undefined : /^major/.test(theme) ? context.theme.major : context.theme.minor
        const font = themed || child.attributes['w:ascii'] || child.attributes['w:hAnsi']
        if (font) look.font = font
        break
      }
      case 'w:b':
        look.bold = toggled(child)
        break
      case 'w:i':
        look.italic = toggled(child)
        break
      case 'w:u':
        look.underline = UNDERLINES[value(child) ?? 'single']
        break
      case 'w:strike':
      case 'w:dstrike':
        look.struck = toggled(child)
        break
      case 'w:color':
        // `auto` is the text's usual colour, whatever a style said.
        look.color = colorAttributes(child, context, { value: 'w:val', theme: 'w:themeColor', shade: 'w:themeShade', tint: 'w:themeTint' })
        break
      case 'w:sz': {
        const size = Number(value(child)) / 2
        if (Number.isFinite(size) && size > 0) look.size = Math.min(size, 400)
        break
      }
      case 'w:highlight':
        look.highlight = colorOf(HIGHLIGHTS[value(child) ?? ''])
        break
      case 'w:shd':
        look.highlight ??= shadingOf(child, context)
        break
      case 'w:vertAlign': {
        const position = value(child)
        look.position = position === 'superscript' ? 'super' : position === 'subscript' ? 'sub' : undefined
        break
      }
      case 'w:caps':
        look.caps = toggled(child) ? 'all' : look.caps === 'all' ? undefined : look.caps
        break
      case 'w:smallCaps':
        look.caps = toggled(child) ? 'small' : look.caps === 'small' ? undefined : look.caps
        break
      case 'w:spacing': {
        const spacing = twips(value(child))
        if (spacing !== undefined) look.spacing = spacing === 0 ? undefined : spacing
        break
      }
      case 'w:vanish':
        look.hidden = toggled(child)
        break
    }
  }
  return look
}

const ALIGNS: Record<string, ParagraphLook['align']> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
  lowKashida: 'justify',
  mediumKashida: 'justify',
  highKashida: 'justify',
  thaiDistribute: 'justify'
}

/** A paragraph's look with what an element of paragraph properties sets over it, its tab stops added to or cleared from those under it. */
function paragraphLook(properties: XmlNode | undefined, under: ParagraphLook, context: Context): ParagraphLook {
  if (!properties) return under
  const own: ParagraphLook = {}
  for (const child of properties.children) {
    const { attributes } = child
    switch (child.name) {
      case 'w:jc':
        own.align = ALIGNS[value(child) ?? ''] ?? 'left'
        break
      case 'w:ind': {
        own.start = twips(attributes['w:start'] ?? attributes['w:left']) ?? own.start
        own.end = twips(attributes['w:end'] ?? attributes['w:right']) ?? own.end
        const hanging = twips(attributes['w:hanging'])
        const first = twips(attributes['w:firstLine'])
        if (hanging !== undefined) own.firstLine = -hanging
        else if (first !== undefined) own.firstLine = first
        break
      }
      case 'w:spacing': {
        const auto = (flag: string) => attributes[flag] === '1' || attributes[flag] === 'true' || attributes[flag] === 'on'
        own.before = auto('w:beforeAutospacing') ? 14 : (twips(attributes['w:before']) ?? own.before)
        own.after = auto('w:afterAutospacing') ? 14 : (twips(attributes['w:after']) ?? own.after)
        const line = Number(attributes['w:line'])
        if (Number.isFinite(line) && line > 0) {
          const rule = attributes['w:lineRule'] ?? 'auto'
          own.line =
            rule === 'exact'
              ? { rule: 'exact', value: line / 20 }
              : rule === 'atLeast'
                ? { rule: 'least', value: line / 20 }
                : { rule: 'multiple', value: line / 240 }
        }
        break
      }
      case 'w:shd':
        own.shading = shadingOf(child, context) ?? 'transparent'
        break
      case 'w:pBdr':
        own.borders = sidesOf(child, context)
        break
      case 'w:tabs': {
        let stops = [...(under.tabs ?? [])]
        for (const tab of childrenNamed(child, 'w:tab')) {
          const position = twips(tab.attributes['w:pos'])
          const kind = tab.attributes['w:val'] ?? 'left'
          if (position === undefined) continue
          stops = stops.filter((stop) => Math.abs(stop.position - position) > 0.5)
          if (kind === 'clear' || kind === 'bar' || kind === 'num') continue
          const leader = tab.attributes['w:leader']
          stops.push({
            position,
            align: kind === 'center' ? 'center' : kind === 'right' || kind === 'end' ? 'right' : kind === 'decimal' ? 'decimal' : 'left',
            leader:
              leader === 'dot' || leader === 'middleDot'
                ? 'dot'
                : leader === 'hyphen'
                  ? 'hyphen'
                  : leader === 'underscore' || leader === 'heavy'
                    ? 'underscore'
                    : undefined
          })
        }
        own.tabs = stops.sort((one, other) => one.position - other.position)
        break
      }
    }
  }
  const look = overParagraph(under, own)
  if (own.shading === 'transparent') look.shading = undefined
  return look
}

// Styles

/** The elements of a style and those it is based on, the most general first, a few steps at most. */
function styleChain(context: Context, id: string | undefined, kind: string): XmlNode[] {
  const chain: XmlNode[] = []
  const passed = new Set<XmlNode>()
  let at = id === undefined ? undefined : context.styles.get(id)
  // Styles based on each other in a ring, of whatever kind, are followed once round.
  while (at && passed.size < 12 && !passed.has(at)) {
    passed.add(at)
    if ((at.attributes['w:type'] ?? 'paragraph') === kind) chain.unshift(at)
    at = context.styles.get(value(childAt(at, 'w:basedOn')) ?? '')
  }
  return chain
}

// Numbering

interface ListLevel {
  start: number
  format: string
  /** The first of a custom format's numbers, as written ("α", "001"). */
  custom?: string | undefined
  align: 'left' | 'center' | 'right'
  text: string
  suffix: string
  legal: boolean
  paragraph: XmlNode | undefined
  run: XmlNode | undefined
}

/** A document's lists: each list's levels, by its identifier, and the counters they share. */
class Numbering {
  private readonly abstracts = new Map<string, XmlNode>()
  private readonly lists = new Map<string, { abstract: string; overrides: Map<number, { start?: number | undefined; level?: XmlNode | undefined }> }>()
  private readonly counters = new Map<string, number[]>()
  private readonly started = new Set<string>()
  private readonly styles: Map<string, XmlNode>

  constructor(xml: string | undefined, styles: Map<string, XmlNode>) {
    this.styles = styles
    const root = childAt(xmlTree(xml ?? ''), 'w:numbering')
    for (const abstract of childrenNamed(root, 'w:abstractNum')) this.abstracts.set(abstract.attributes['w:abstractNumId'] ?? '', abstract)
    for (const list of childrenNamed(root, 'w:num')) {
      const overrides = new Map<number, { start?: number | undefined; level?: XmlNode | undefined }>()
      for (const override of childrenNamed(list, 'w:lvlOverride')) {
        const start = Number(value(childAt(override, 'w:startOverride')))
        overrides.set(Number(override.attributes['w:ilvl'] ?? 0), {
          start: Number.isFinite(start) && childAt(override, 'w:startOverride') ? start : undefined,
          level: childAt(override, 'w:lvl')
        })
      }
      this.lists.set(list.attributes['w:numId'] ?? '', { abstract: value(childAt(list, 'w:abstractNumId')) ?? '', overrides })
    }
  }

  /** The abstract list a list follows, through the style a list of styles links to, once at most. */
  private abstractOf(list: string, followed = false): XmlNode | undefined {
    const abstract = this.abstracts.get(this.lists.get(list)?.abstract ?? '')
    const linked = value(childAt(abstract, 'w:numStyleLink'))
    if (linked === undefined || followed) return abstract
    const style = this.styles.get(linked)
    const through = value(childAt(style, 'w:pPr', 'w:numPr', 'w:numId'))
    return through === undefined ? abstract : (this.abstractOf(through, true) ?? abstract)
  }

  level(list: string, at: number): ListLevel | undefined {
    const abstract = this.abstractOf(list)
    const override = this.lists.get(list)?.overrides.get(at)
    const node = override?.level ?? childrenNamed(abstract, 'w:lvl').find((level) => Number(level.attributes['w:ilvl'] ?? 0) === at)
    if (!node) return undefined
    const start = Number(value(childAt(node, 'w:start')))
    return {
      start: override?.start ?? (Number.isFinite(start) && childAt(node, 'w:start') ? start : 1),
      ...numberFormat(node),
      align:
        value(childAt(node, 'w:lvlJc')) === 'right' || value(childAt(node, 'w:lvlJc')) === 'end'
          ? 'right'
          : value(childAt(node, 'w:lvlJc')) === 'center'
            ? 'center'
            : 'left',
      text: value(childAt(node, 'w:lvlText')) ?? '',
      suffix: value(childAt(node, 'w:suff')) ?? 'tab',
      legal: childAt(node, 'w:isLgl') !== undefined,
      paragraph: childAt(node, 'w:pPr'),
      run: childAt(node, 'w:rPr')
    }
  }

  /**
   * The mark of the next item of a list at a level: its counters move on, those of deeper levels start again. Lists of
   * one abstract list count together, unless a list starts its own again.
   */
  next(list: string, at: number): string | undefined {
    const level = this.level(list, at)
    if (!level) return undefined
    const own = this.lists.get(list)?.overrides.get(at)?.start !== undefined
    const key = own ? `list:${list}` : `abstract:${this.lists.get(list)?.abstract ?? list}`
    const counters = this.counters.get(key) ?? []
    if (own && !this.started.has(`${key}:${at}`)) {
      this.started.add(`${key}:${at}`)
      counters[at] = level.start - 1
    }
    counters[at] = (counters[at] ?? level.start - 1) + 1
    counters.length = at + 1
    this.counters.set(key, counters)
    if (level.format === 'none') return ''
    if (level.format === 'bullet') return level.text
    return level.text.replace(/%([1-9])/g, (_, digit: string) => {
      const depth = Number(digit) - 1
      const shown = depth === at ? level : this.level(list, depth)
      const count = counters[depth] ?? shown?.start ?? 1
      return level.legal && depth !== at ? String(count) : listMark(shown?.format ?? 'decimal', count, shown?.custom)
    })
  }
}

/** A level's format of numbers, Word 2010's custom one where it gives one, else the one it keeps for older apps. */
function numberFormat(level: XmlNode): { format: string; custom?: string | undefined } {
  const alternative = childAt(level, 'mc:AlternateContent')
  const given = childAt(level, 'w:numFmt') ?? childAt(alternative, 'mc:Choice', 'w:numFmt') ?? childAt(alternative, 'mc:Fallback', 'w:numFmt')
  const format = value(given) ?? 'decimal'
  if (format !== 'custom') return { format }
  const first = given?.attributes['w:format']?.split(',')[0]?.trim()
  return first ? { format, custom: first } : { format: value(childAt(alternative, 'mc:Fallback', 'w:numFmt')) ?? 'decimal' }
}

const CARDINALS = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty'
]
const ORDINALS = [
  '',
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth'
]
const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * A number of a list as its format writes it. A custom format counts on from its first number: digits keep their
 * width ("001"), a letter goes on through its alphabet ("α", "β", "γ").
 */
export function listMark(format: string, count: number, custom?: string): string {
  // Word counts from 0 to 32,767; a damaged count past them is written as it is, never spelt out.
  if (!Number.isInteger(count) || count < 0 || count > 32_767) return Number.isFinite(count) ? String(Math.round(count)) : '0'
  if (format === 'custom' && custom !== undefined) {
    if (/^\d+$/.test(custom)) return String(Number(custom) + count - 1).padStart(custom.length, '0')
    const first = custom.codePointAt(0) ?? 0x61
    // Greek's final sigma is no number.
    const code = first + count - 1 + (first <= 0x3c2 && first + count - 1 >= 0x3c2 && first >= 0x3b1 ? 1 : 0)
    return String.fromCodePoint(code) + [...custom].slice(1).join('')
  }
  const roman = (left: number) => {
    let written = ''
    for (const [amount, numeral] of [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i']
    ] as const)
      while (left >= amount) {
        written += numeral
        left -= amount
      }
    return written
  }
  // Word writes the 27th letter as "aa", the 28th as "bb".
  const letters = (value: number) => (value < 1 ? '' : String.fromCharCode(97 + ((value - 1) % 26)).repeat(Math.floor((value - 1) / 26) + 1))
  switch (format) {
    case 'upperRoman':
      return roman(count).toUpperCase()
    case 'lowerRoman':
      return roman(count)
    case 'upperLetter':
      return letters(count).toUpperCase()
    case 'lowerLetter':
      return letters(count)
    case 'decimalZero':
      return String(count).padStart(2, '0')
    case 'russianLower':
    case 'russianUpper': {
      const letters = 'абвгдежзиклмнопрстуфхцчшщэюя'
      const letter = (letters[(count - 1) % letters.length] ?? '').repeat(Math.floor((count - 1) / letters.length) + 1)
      return format === 'russianUpper' ? letter.toUpperCase() : letter
    }
    case 'decimalEnclosedCircle':
      return count >= 1 && count <= 20 ? String.fromCodePoint(0x2460 + count - 1) : String(count)
    case 'decimalFullWidth':
      return [...String(count)].map((digit) => String.fromCodePoint(0xff10 + Number(digit))).join('')
    case 'cardinalText':
      return capitalised(CARDINALS[count] ?? String(count))
    case 'ordinalText':
      return capitalised(ORDINALS[count] ?? String(count))
    case 'ordinal': {
      const tens = count % 100
      const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][count % 10] ?? 'th')
      return `${count}${suffix}`
    }
    default:
      return String(count)
  }
}

// Sections

interface Section {
  width: number
  height: number
  margins: DocumentPage['margins']
  columns: number
  gap: number
  type: string
  headers: Map<string, string>
  footers: Map<string, string>
  titlePage: boolean
  start?: number | undefined
  format: string
}

function sectionOf(node: XmlNode | undefined, before: Section | undefined): Section {
  const size = childAt(node, 'w:pgSz')
  const margin = childAt(node, 'w:pgMar')
  const columns = childAt(node, 'w:cols')
  const numbers = childAt(node, 'w:pgNumType')
  const references = (name: string, inherited: Map<string, string> | undefined) => {
    const found = new Map(inherited)
    for (const reference of childrenNamed(node, name)) found.set(reference.attributes['w:type'] ?? 'default', reference.attributes['r:id'] ?? '')
    return found
  }
  const at = (name: string, fallback: number) => twips(margin?.attributes[name]) ?? fallback
  // Word's pages are 0.1 to 22 inches across and down.
  const width = within(twips(size?.attributes['w:w']) ?? 612, 7.2, 1584)
  const height = within(twips(size?.attributes['w:h']) ?? 792, 7.2, 1584)
  const start = Number(numbers?.attributes['w:start'])
  return {
    width,
    height,
    margins: {
      top: within(Math.abs(at('w:top', 72)), 0, height / 2),
      right: within(at('w:right', 72), 0, width / 2),
      bottom: within(Math.abs(at('w:bottom', 72)), 0, height / 2),
      left: within(at('w:left', 72) + at('w:gutter', 0), 0, width / 2),
      header: within(at('w:header', 36), 0, height / 2),
      footer: within(at('w:footer', 36), 0, height / 2)
    },
    columns: within(Math.floor(Number(columns?.attributes['w:num']) || 1), 1, 12),
    gap: within(twips(columns?.attributes['w:space']) ?? 36, 0, width / 2),
    type: value(childAt(node, 'w:type')) ?? 'nextPage',
    headers: references('w:headerReference', before?.headers),
    footers: references('w:footerReference', before?.footers),
    titlePage: childAt(node, 'w:titlePg') !== undefined && toggled(childAt(node, 'w:titlePg') as XmlNode),
    start: Number.isFinite(start) && numbers?.attributes['w:start'] !== undefined ? start : undefined,
    format: numbers?.attributes['w:fmt'] ?? 'decimal'
  }
}

// Reading

/** Elements whose content is read as if it stood in their place: content controls, smart tags, insertions, custom XML. */
const WRAPPERS = new Set(['w:sdt', 'w:sdtContent', 'w:customXml', 'w:smartTag', 'w:ins', 'w:moveTo', 'w:dir', 'w:bdo'])

/** The children of an element, with those of wrappers in their place and what Word keeps for older apps passed over. */
function* unwrapped(node: XmlNode): Generator<XmlNode> {
  for (const child of node.children) {
    if (child.name === 'w:sdt') {
      const content = childAt(child, 'w:sdtContent')
      if (content) yield* unwrapped(content)
    } else if (WRAPPERS.has(child.name)) yield* unwrapped(child)
    else if (child.name === 'mc:AlternateContent') {
      const choice = childAt(child, 'mc:Choice')
      if (choice) yield* unwrapped(choice)
    } else yield child
  }
}

/** A field open as a story is read: its instruction, whether its result is being read, and what it stands for. */
interface OpenField {
  instruction: string
  result: boolean
  replaced: boolean
  link?: string | undefined
}

/** A part of the document read as a story of its own: its relationships, and the fields open in it. */
interface Story {
  targets: Map<string, string>
  fields: OpenField[]
  /** The width of its text, for tabs placed by alignment. */
  width: number
}

/** What a paragraph's content is read into: its pieces, and where pages break between them. */
type Piece = DocumentSpan | 'page'

/** Where a table cell is, for its style's looks of rows, columns and bands. */
interface CellPlace {
  row: number
  rows: number
  column: number
  columns: number
  span: number
}

/** A table's style, read for its cells: its elements, the most general first, which of its looks the table uses, and how many rows and columns make a band. */
interface TableStyle {
  chain: XmlNode[]
  look: { firstRow: boolean; lastRow: boolean; firstColumn: boolean; lastColumn: boolean; rowBands: boolean; columnBands: boolean }
  rowBand: number
  columnBand: number
}

/** The kinds of a table style's looks a cell takes, in the order they are set one over the other. */
function cellKinds(place: CellPlace, style: TableStyle): string[] {
  const { look } = style
  const kinds = ['wholeTable']
  const first = look.firstRow && place.row === 0
  const last = look.lastRow && place.row === place.rows - 1
  const firstColumn = look.firstColumn && place.column === 0
  const lastColumn = look.lastColumn && place.column + place.span >= place.columns
  if (look.columnBands && !firstColumn && !lastColumn) {
    const index = place.column - (look.firstColumn ? 1 : 0)
    kinds.push(Math.floor(index / style.columnBand) % 2 === 0 ? 'band1Vert' : 'band2Vert')
  }
  if (look.rowBands && !first && !last) {
    const index = place.row - (look.firstRow ? 1 : 0)
    kinds.push(Math.floor(index / style.rowBand) % 2 === 0 ? 'band1Horz' : 'band2Horz')
  }
  if (firstColumn) kinds.push('firstCol')
  if (lastColumn) kinds.push('lastCol')
  if (first) kinds.push('firstRow')
  if (last) kinds.push('lastRow')
  if (first && firstColumn) kinds.push('nwCell')
  if (first && lastColumn) kinds.push('neCell')
  if (last && firstColumn) kinds.push('swCell')
  if (last && lastColumn) kinds.push('seCell')
  return kinds
}

/** The elements of a table style's look of a kind, the most general first. */
const kindElements = (style: TableStyle, kind: string): XmlNode[] =>
  kind === 'wholeTable'
    ? style.chain
    : style.chain.flatMap((node) => childrenNamed(node, 'w:tblStylePr').filter((conditional) => conditional.attributes['w:type'] === kind))

/** The properties of a name in elements, the most general first. */
const propertiesIn = (nodes: readonly XmlNode[], name: string): XmlNode[] => nodes.flatMap((node) => childrenNamed(node, name))

/** A paragraph's place among others, for spacing that leaves out the space between paragraphs of one style. */
interface Spaced {
  style: string | undefined
  contextual: boolean
  /** Whether the space before and after it is the automatic space of HTML, which the next one's overlaps rather than adds to. */
  autoBefore: boolean
  autoAfter: boolean
}

class WordReader {
  readonly context: Context
  private readonly archive: Archive
  private readonly figures: Figures
  private readonly sections: Section[]
  private section = 0
  private blocks = 0
  cut = false
  readonly pages: { section: number; bands: (PageBand & { section: number })[]; notes: DocumentPage['notes'] }[] = []
  private pending = true
  private readonly spaced = new WeakMap<DocumentParagraph, Spaced>()
  private readonly notes = new Map<string, XmlNode>()
  private readonly endNotes = new Map<string, XmlNode>()
  readonly endNotesRead: DocumentLook['endNotes'] = []
  private noteCount = 0
  private noteQueue: DocumentPage['notes'] = []
  private readonly notesStory: Story
  private readonly endNotesStory: Story

  constructor(
    archive: Archive,
    figures: Figures,
    context: Context,
    sections: Section[],
    notes: { foot: XmlNode | undefined; end: XmlNode | undefined; footTargets: Map<string, string>; endTargets: Map<string, string> }
  ) {
    this.archive = archive
    this.figures = figures
    this.context = context
    this.sections = sections
    for (const note of childrenNamed(notes.foot, 'w:footnote')) this.notes.set(note.attributes['w:id'] ?? '', note)
    for (const note of childrenNamed(notes.end, 'w:endnote')) this.endNotes.set(note.attributes['w:id'] ?? '', note)
    const width = this.textWidth(sections[0])
    this.notesStory = { targets: notes.footTargets, fields: [], width }
    this.endNotesStory = { targets: notes.endTargets, fields: [], width }
  }

  textWidth(section: Section | undefined): number {
    return section ? Math.max(36, section.width - section.margins.left - section.margins.right) : 468
  }

  get full(): boolean {
    return this.blocks >= BLOCK_LIMIT
  }

  // Pages

  private get page() {
    if (this.pending || this.pages.length === 0) {
      this.pending = false
      this.pages.push({ section: this.section, bands: [this.band()], notes: [] })
    }
    return this.pages.at(-1) as WordReader['pages'][number]
  }

  private band(): PageBand & { section: number } {
    const section = this.sections[this.section]
    return { section: this.section, columns: section?.columns ?? 1, gap: section?.gap ?? 36, blocks: [] }
  }

  /** A block of the body on its page, with the notes it named at the foot of that page. */
  place(block: DocumentBlock): void {
    const page = this.page
    page.bands.at(-1)?.blocks.push(block)
    page.notes.push(...this.noteQueue)
    this.noteQueue = []
  }

  /** The next content goes on a new page, unless the page has none yet. */
  breakPage(): void {
    const page = this.pages.at(-1)
    if (page?.bands.some((band) => band.blocks.length > 0)) this.pending = true
  }

  /** A section ends after a paragraph: the next starts on a new page, or on the same one in a band of its own. */
  endSection(): void {
    if (this.section >= this.sections.length - 1) return
    this.section++
    const next = this.sections[this.section]
    if (next?.type === 'continuous' && !this.pending && this.pages.length > 0) this.pages.at(-1)?.bands.push(this.band())
    else this.breakPage()
  }

  // Blocks

  /** The blocks of a story's element (the body, a cell, a note, a text box), each paragraph and table read in turn. */
  async readBlocks(node: XmlNode, story: Story, table?: { style: TableStyle; kinds: string[] }): Promise<DocumentBlock[]> {
    const blocks: DocumentBlock[] = []
    for (const child of unwrapped(node)) {
      if (this.full) {
        this.cut = true
        break
      }
      if (child.name === 'w:p') blocks.push(...(await this.readParagraph(child, story, table)))
      else if (child.name === 'w:tbl') blocks.push(...(await this.readTable(child, story, false)))
    }
    this.spaceContextually(blocks)
    return blocks
  }

  /** The body, its blocks placed on pages, breaking where it says and between its sections. */
  async readBody(body: XmlNode, story: Story): Promise<void> {
    for (const child of unwrapped(body)) {
      if (this.full) {
        this.cut = true
        break
      }
      if (child.name === 'w:p') {
        const properties = childAt(child, 'w:pPr')
        const breakBefore = childAt(properties, 'w:pageBreakBefore')
        if (breakBefore && toggled(breakBefore)) this.breakPage()
        const pieces = await this.readParagraphPieces(child, story)
        const ending = childAt(properties, 'w:sectPr') !== undefined
        // A paragraph that only ends its section, empty, makes no line.
        const parts = ending && pieces.pieces.length === 0 ? [] : this.split(pieces)
        parts.forEach((part, index) => {
          if (index > 0) this.breakPage()
          if (part) this.place(part)
        })
        if (ending) this.endSection()
      } else if (child.name === 'w:tbl') {
        const parts = await this.readTable(child, story, true)
        parts.forEach((part, index) => {
          if (index > 0) this.breakPage()
          this.place(part)
        })
      }
    }
    for (const page of this.pages) for (const band of page.bands) this.spaceContextually(band.blocks)
  }

  /**
   * Paragraphs of one style next to each other, where their style says so, have no space between them; the automatic
   * space after one and before the next overlap, the larger kept.
   */
  private spaceContextually(blocks: DocumentBlock[]): void {
    blocks.forEach((block, index) => {
      const next = blocks[index + 1]
      if (block.kind !== 'paragraph' || next?.kind !== 'paragraph') return
      const one = this.spaced.get(block)
      const other = this.spaced.get(next)
      if (!one || !other) return
      if (one.style === other.style) {
        if (one.contextual) block.look.after = 0
        if (other.contextual) next.look.before = 0
      }
      if (one.autoAfter && other.autoBefore) next.look.before = Math.max(0, (next.look.before ?? 0) - (block.look.after ?? 0))
    })
  }

  // Paragraphs

  /** What a paragraph is set with: the elements of its paragraph and run properties, the most general first, and its list. */
  private paragraphBase(node: XmlNode, table: { style: TableStyle; kinds: string[] } | undefined) {
    const { context } = this
    const properties = childAt(node, 'w:pPr')
    const styleId = value(childAt(properties, 'w:pStyle')) ?? context.defaultParagraph
    const chain = styleChain(context, styleId, 'paragraph')
    const defaultChain = styleChain(context, context.defaultParagraph, 'paragraph')
    // A table's style comes between the document's default paragraph style and any other.
    const tableNodes = table ? table.kinds.flatMap((kind) => kindElements(table.style, kind)) : []
    const isDefault = styleId === context.defaultParagraph
    const styleNodes = table ? (isDefault ? [...defaultChain, ...tableNodes] : [...tableNodes, ...chain]) : chain
    const paragraphNodes = [context.defaults.paragraph, ...propertiesIn(styleNodes, 'w:pPr')].filter((one): one is XmlNode => one !== undefined)
    const runNodes = [context.defaults.run, ...propertiesIn(styleNodes, 'w:rPr')].filter((one): one is XmlNode => one !== undefined)

    // Its list: its own, else its style's.
    let list: { id: string; level: number } | undefined
    const own = childAt(properties, 'w:numPr')
    const styled = [...chain]
      .reverse()
      .map((style) => childAt(style, 'w:pPr', 'w:numPr'))
      .find(Boolean)
    const id = value(childAt(own, 'w:numId')) ?? value(childAt(styled, 'w:numId'))
    if (id !== undefined && id !== '0') list = { id, level: Number(value(childAt(own, 'w:ilvl')) ?? value(childAt(styled, 'w:ilvl')) ?? 0) || 0 }
    const level = list ? context.numbering.level(list.id, list.level) : undefined

    let look: ParagraphLook = {}
    for (const one of paragraphNodes) look = paragraphLook(one, look, context)
    if (level?.paragraph) look = paragraphLook(level.paragraph, look, context)
    look = paragraphLook(properties, look, context)

    let base: RunRead = {}
    for (const one of runNodes) base = runLook(one, base, context)
    const mark = runLook(childAt(properties, 'w:rPr'), base, context)
    const name = (chain.at(-1) && value(childAt(chain.at(-1), 'w:name'))?.toLowerCase()) ?? ''
    const heading = name === 'title' ? 1 : name === 'subtitle' ? 2 : Number(/^heading (\d)$/.exec(name)?.[1] ?? 0) || undefined
    // The last that says wins: whether to leave out the space between paragraphs of one style, and whether the space is automatic.
    let contextual = false
    let autoBefore = false
    let autoAfter = false
    const flag = (given: string | undefined) => given === '1' || given === 'true' || given === 'on'
    for (const one of [...paragraphNodes, level?.paragraph, properties]) {
      const found = childAt(one, 'w:contextualSpacing')
      if (found) contextual = toggled(found)
      const spacing = childAt(one, 'w:spacing')?.attributes ?? {}
      if (spacing['w:beforeAutospacing'] !== undefined) autoBefore = flag(spacing['w:beforeAutospacing'])
      else if (spacing['w:before'] !== undefined) autoBefore = false
      if (spacing['w:afterAutospacing'] !== undefined) autoAfter = flag(spacing['w:afterAutospacing'])
      else if (spacing['w:after'] !== undefined) autoAfter = false
    }
    return { properties, look, base, mark, list, level, heading: heading && Math.min(heading, 6), styleId, spacing: { contextual, autoBefore, autoAfter } }
  }

  /** A paragraph read whole, where its pages break left out: in a cell, a note or a text box. */
  private async readParagraph(node: XmlNode, story: Story, table?: { style: TableStyle; kinds: string[] }): Promise<DocumentParagraph[]> {
    const { paragraph, pieces } = await this.readParagraphPieces(node, story, table)
    paragraph.spans = pieces.filter((piece): piece is DocumentSpan => piece !== 'page')
    return [paragraph]
  }

  /**
   * A paragraph cut where its pages break, a part for each page, none where a page has none of it: a part on a later
   * page goes on without its number, its first line's indent or the space before it.
   */
  private split({ paragraph, pieces }: { paragraph: DocumentParagraph; pieces: Piece[] }): (DocumentParagraph | undefined)[] {
    const runs: DocumentSpan[][] = [[]]
    for (const piece of pieces) {
      if (piece === 'page') runs.push([])
      else runs.at(-1)?.push(piece)
    }
    if (runs.length === 1) {
      paragraph.spans = runs[0] ?? []
      return [paragraph]
    }
    const firstShown = runs.findIndex((spans) => spans.length > 0)
    const lastShown = runs.findLastIndex((spans) => spans.length > 0)
    const spacing = this.spaced.get(paragraph)
    return runs.map((spans, index) => {
      if (spans.length === 0) return undefined
      const look = { ...paragraph.look }
      if (index > firstShown) {
        look.before = 0
        look.firstLine = 0
      }
      if (index < lastShown) look.after = 0
      const part: DocumentParagraph = { ...paragraph, look, spans, marker: index === firstShown ? paragraph.marker : undefined }
      if (spacing) this.spaced.set(part, spacing)
      return part
    })
  }

  private async readParagraphPieces(node: XmlNode, story: Story, table?: { style: TableStyle; kinds: string[] }) {
    this.blocks++
    const base = this.paragraphBase(node, table)
    const { context } = this
    const paragraph: DocumentParagraph = { kind: 'paragraph', look: base.look, spans: [], mark: strip(base.mark), heading: base.heading }
    this.spaced.set(paragraph, { style: base.styleId, ...base.spacing })
    if (base.list && base.level) {
      const text = context.numbering.next(base.list.id, base.list.level)
      if (text !== undefined && text !== '') {
        const look = runLook(base.level.run, base.mark, context)
        const symbol = look.font !== undefined && SYMBOL_FONTS.test(look.font)
        const shown = symbol ? [...text].map((character) => symbolCharacter(look.font ?? '', character)).join('') : text
        if (!look.hidden)
          paragraph.marker = {
            text: base.level.suffix === 'space' ? `${shown} ` : shown,
            look: strip(symbol ? { ...look, font: undefined } : look),
            tab: base.level.suffix === 'tab',
            align: base.level.align === 'left' ? undefined : base.level.align
          }
      }
    }
    const pieces: Piece[] = []
    await this.readInline(node, story, base.base, pieces, undefined)
    return { paragraph, pieces }
  }

  /** Whether text is shown: not inside a field's instruction, nor the result of a field shown otherwise. */
  private shown(story: Story): boolean {
    return story.fields.every((field) => field.result && !field.replaced)
  }

  private fieldLink(story: Story): string | undefined {
    for (let at = story.fields.length - 1; at >= 0; at--) {
      const link = story.fields[at]?.link
      if (link !== undefined) return link
    }
    return undefined
  }

  /** The content of a paragraph or of what is inside one (a link, a field, a run), its pieces added to `pieces`. */
  private async readInline(node: XmlNode, story: Story, base: RunRead, pieces: Piece[], link: string | undefined): Promise<void> {
    for (const child of unwrapped(node)) {
      switch (child.name) {
        case 'w:r':
          await this.readRun(child, story, base, pieces, link)
          break
        case 'w:hyperlink': {
          const target = story.targets.get(child.attributes['r:id'] ?? '')
          const anchor = child.attributes['w:anchor']
          await this.readInline(child, story, base, pieces, target ?? (anchor === undefined ? link : `#${anchor}`))
          break
        }
        case 'w:fldSimple': {
          const instruction = child.attributes['w:instr'] ?? ''
          const field = fieldKind(instruction)
          if (field) {
            const look = this.runOf(childAt(childAt(child, 'w:r'), 'w:rPr'), base)
            if (!look.hidden && this.shown(story)) pieces.push({ field, look: strip(look) })
          } else await this.readInline(child, story, base, pieces, fieldTarget(instruction) ?? link)
          break
        }
        case 'm:oMathPara':
        case 'm:oMath': {
          if (!this.shown(story)) break
          const equations = child.name === 'm:oMath' ? [child] : childrenNamed(child, 'm:oMath')
          for (const equation of equations) {
            const text = mathText([...nodeEvents(equation)])
            if (text === '') continue
            if (child.name === 'm:oMathPara' && pieces.length > 0) pieces.push({ break: true })
            pieces.push({ text, look: strip({ ...base, font: 'Cambria Math', italic: true }) })
          }
          break
        }
      }
    }
  }

  /** A run's look: its character style and its own properties over the paragraph's. */
  private runOf(properties: XmlNode | undefined, base: RunRead): RunRead {
    const { context } = this
    let look = base
    for (const style of styleChain(context, value(childAt(properties, 'w:rStyle')), 'character')) look = runLook(childAt(style, 'w:rPr'), look, context)
    return runLook(properties, look, context)
  }

  private async readRun(node: XmlNode, story: Story, base: RunRead, pieces: Piece[], link: string | undefined): Promise<void> {
    const look = this.runOf(childAt(node, 'w:rPr'), base)
    const set = strip(look)
    const add = (piece: DocumentSpan) => {
      if (!look.hidden && this.shown(story)) pieces.push(piece)
    }
    for (const child of unwrapped(node)) {
      switch (child.name) {
        case 'w:t': {
          const text = child.children.map((one) => one.text).join('')
          if (text !== '') add({ text, look: set, link: this.fieldLink(story) ?? link })
          break
        }
        case 'w:sym': {
          const code = Number.parseInt(child.attributes['w:char'] ?? '', 16)
          if (!Number.isFinite(code)) break
          const font = child.attributes['w:font'] ?? ''
          const symbol = SYMBOL_FONTS.test(font)
          const character = String.fromCharCode(code)
          add({
            text: symbol ? symbolCharacter(font, character) : String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code),
            look: symbol ? set : { ...set, font }
          })
          break
        }
        case 'w:tab':
          add({ tab: true, look: set })
          break
        case 'w:ptab': {
          // A tab to the middle or the end of the text's width, wherever its stops are.
          const align = child.attributes['w:alignment']
          const leader = child.attributes['w:leader']
          add({
            tab: true,
            look: set,
            stop: {
              position: align === 'center' ? story.width / 2 : align === 'right' ? story.width : 0,
              align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
              leader: leader === 'dot' || leader === 'middleDot' ? 'dot' : leader === 'hyphen' ? 'hyphen' : leader === 'underscore' ? 'underscore' : undefined
            }
          })
          break
        }
        case 'w:noBreakHyphen':
          add({ text: '\u2011', look: set })
          break
        case 'w:br':
        case 'w:cr': {
          const kind = child.attributes['w:type']
          if (kind === 'page') {
            if (this.shown(story)) pieces.push('page')
          } else if (kind !== 'column') add({ break: true })
          break
        }
        case 'w:lastRenderedPageBreak':
          pieces.push('page')
          break
        case 'w:fldChar': {
          const kind = child.attributes['w:fldCharType']
          if (kind === 'begin') story.fields.push({ instruction: '', result: false, replaced: false })
          else if (kind === 'separate') {
            const field = story.fields.at(-1)
            if (!field) break
            const shown = story.fields.slice(0, -1).every((one) => one.result && !one.replaced)
            const kindOf = fieldKind(field.instruction)
            if (kindOf && shown && !look.hidden) pieces.push({ field: kindOf, look: set })
            field.replaced = kindOf !== undefined
            field.link = fieldTarget(field.instruction)
            field.result = true
          } else if (kind === 'end') story.fields.pop()
          break
        }
        case 'w:instrText': {
          const field = story.fields.at(-1)
          if (field && !field.result) field.instruction += child.children.map((one) => one.text).join('')
          break
        }
        case 'w:footnoteReference':
        case 'w:endnoteReference': {
          if (look.hidden || !this.shown(story)) break
          const mark = ++this.noteCount
          pieces.push({ note: mark, look: set })
          const foot = child.name === 'w:footnoteReference'
          const note = (foot ? this.notes : this.endNotes).get(child.attributes['w:id'] ?? '')
          if (!note) break
          const blocks = await this.readNote(note, foot ? this.notesStory : this.endNotesStory, mark)
          if (foot) this.noteQueue.push({ mark, blocks })
          else this.endNotesRead.push({ mark, blocks })
          break
        }
        case 'w:footnoteRef':
        case 'w:endnoteRef':
          add({ note: this.noteMark, look: set })
          break
        case 'w:drawing': {
          const placed = await this.readDrawing(child, story)
          if (placed) add(placed)
          break
        }
        case 'w:pict':
        case 'w:object': {
          const placed = await this.readVml(child, story)
          if (placed) add(placed)
          break
        }
      }
    }
  }

  /** The mark of the note being read, for its own mark at its start. */
  private noteMark = 0

  private async readNote(note: XmlNode, story: Story, mark: number): Promise<DocumentBlock[]> {
    const before = this.noteMark
    this.noteMark = mark
    const blocks = await this.readBlocks(note, story)
    this.noteMark = before
    return blocks
  }

  // Figures and boxes

  /** Where an anchored drawing sits: floating at a side of the text, over or behind it at a place, or in its line. */
  private placement(anchor: XmlNode, size: { width: number; height: number }): Pick<PlacedFigure, 'float' | 'at'> {
    const section = this.sections[this.section] ?? sectionOf(undefined, undefined)
    const { margins } = section
    const across = childAt(anchor, 'wp:positionH')
    const down = childAt(anchor, 'wp:positionV')
    const horizontal = across?.attributes.relativeFrom ?? 'column'
    const vertical = down?.attributes.relativeFrom ?? 'paragraph'
    const textWidth = this.textWidth(section)
    // Across, from the page's left edge.
    const area =
      horizontal === 'page'
        ? { start: 0, width: section.width }
        : horizontal === 'leftMargin'
          ? { start: 0, width: margins.left }
          : horizontal === 'rightMargin'
            ? { start: section.width - margins.right, width: margins.right }
            : { start: margins.left, width: textWidth }
    const alignAcross = childAt(across, 'wp:align')?.children[0]?.text.trim()
    const offsetAcross = emuPoints(childAt(across, 'wp:posOffset')?.children[0]?.text.trim()) ?? 0
    const x =
      alignAcross === 'center'
        ? area.start + (area.width - size.width) / 2
        : alignAcross === 'right' || alignAcross === 'outside'
          ? area.start + area.width - size.width
          : alignAcross === 'left' || alignAcross === 'inside'
            ? area.start
            : area.start + offsetAcross
    const wraps = ['wp:wrapSquare', 'wp:wrapTight', 'wp:wrapThrough'].some((name) => childAt(anchor, name))
    if (wraps) return { float: x + size.width / 2 > section.width / 2 ? 'right' : 'left' }
    if (childAt(anchor, 'wp:wrapTopAndBottom')) return {}
    const alignDown = childAt(down, 'wp:align')?.children[0]?.text.trim()
    const offsetDown = emuPoints(childAt(down, 'wp:posOffset')?.children[0]?.text.trim()) ?? 0
    if (vertical === 'paragraph' || vertical === 'line') return { at: { x: x - margins.left, y: offsetDown, from: 'paragraph' } }
    const band =
      vertical === 'page'
        ? { start: 0, height: section.height }
        : vertical === 'topMargin'
          ? { start: 0, height: margins.top }
          : vertical === 'bottomMargin'
            ? { start: section.height - margins.bottom, height: margins.bottom }
            : { start: margins.top, height: section.height - margins.top - margins.bottom }
    const y =
      alignDown === 'center'
        ? band.start + (band.height - size.height) / 2
        : alignDown === 'bottom' || alignDown === 'outside'
          ? band.start + band.height - size.height
          : alignDown === 'top' || alignDown === 'inside'
            ? band.start
            : band.start + offsetDown
    return { at: { x, y, from: 'page' } }
  }

  /** A DrawingML drawing in a run: a picture, a chart or a box of text, in its line or anchored. */
  private async readDrawing(node: XmlNode, story: Story): Promise<DocumentSpan | undefined> {
    const holder = childAt(node, 'wp:inline') ?? childAt(node, 'wp:anchor')
    if (!holder) return undefined
    const extent = childAt(holder, 'wp:extent')
    const size = { width: emuPoints(extent?.attributes.cx) ?? 0, height: emuPoints(extent?.attributes.cy) ?? 0 }
    const described = childAt(holder, 'wp:docPr')
    const alt = described?.attributes.descr || described?.attributes.title || ''
    const placement = holder.name === 'wp:anchor' ? this.placement(holder, size) : {}
    const data = childAt(holder, 'a:graphic', 'a:graphicData')
    const shape = findNode(data, (one) => one.name === 'wps:wsp')
    const content = findNode(shape, (one) => one.name === 'w:txbxContent')
    if (content && shape) {
      const box = await this.readBox(content, story, size, childAt(shape, 'wps:spPr'), childAt(shape, 'wps:bodyPr'))
      return { box: { ...box, ...placement } }
    }
    const blip = findNode(data, (one) => one.name === 'a:blip')
    const chart = findNode(data, (one) => one.name === 'c:chart')
    // The figure is the one the document's text reads, at the size in pixels it is read at, so it is read once.
    const pixels = { width: emuPixels(extent?.attributes.cx), height: emuPixels(extent?.attributes.cy) }
    const figure =
      chart !== undefined
        ? await this.figures.chart(story.targets.get(chart.attributes['r:id'] ?? ''), alt, readChart)
        : blip !== undefined
          ? await this.figures.picture(story.targets.get(blip.attributes['r:embed'] ?? ''), alt, pixels)
          : undefined
    if (figure === undefined) return undefined
    return { placed: { figure, alt, width: size.width || undefined, height: size.height || undefined, ...placement } }
  }

  /** A VML drawing in a run (`w:pict`, an object's picture): a picture in its line, or a box of text. */
  private async readVml(node: XmlNode, story: Story): Promise<DocumentSpan | undefined> {
    const shape = findNode(node, (one) => one.name === 'v:shape' || one.name === 'v:rect' || one.name === 'v:roundrect')
    const style = shape?.attributes.style ?? ''
    const dimension = (name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:([^;]+)`).exec(style)?.[1]?.trim()
    const width = dimension('width')
    const height = dimension('height')
    const content = findNode(node, (one) => one.name === 'w:txbxContent')
    const points = (given: string | undefined) => {
      const pixels = lengthPixels(given)
      return pixels === undefined ? undefined : (pixels * 3) / 4
    }
    if (content) {
      const box = await this.readBox(content, story, { width: points(width) ?? 0, height: points(height) ?? 0 }, undefined, undefined)
      const fill = colorOf(shape?.attributes.fillcolor?.replace(/^#/, ''))
      return { box: { ...box, fill: shape?.attributes.filled === 'f' ? undefined : fill } }
    }
    // A rule across the text, as Word writes HTML's.
    if (shape?.attributes['o:hr'] === 't') {
      const share = Number(shape.attributes['o:hrpct']) || 1000
      return {
        box: {
          width: (story.width * share) / 1000,
          height: points(height) ?? 1.5,
          fill: colorOf(shape.attributes.fillcolor?.replace(/^#/, '')) ?? '#a0a0a0',
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
          blocks: []
        }
      }
    }
    const data = findNode(node, (one) => one.name === 'v:imagedata')
    const target = data?.attributes['r:id']
    if (target === undefined) return undefined
    // An equation of Equation Editor or MathType is shown by its picture, its linear text the picture's words; what
    // another object holds is shown in its place when it is read here, a worksheet as its sheet.
    const object = findNode(node, (one) => one.name === 'o:OLEObject')
    const program = object?.attributes.ProgID ?? ''
    const part = story.targets.get(object?.attributes['r:id'] ?? '')
    const equation = isEquationProgram(program) ? await this.figures.equation(part) : undefined
    // A document's text is the words of its picture.
    const words = equation ?? (await this.figures.text(part, program))?.lines.join(' ')
    const alt = words ?? data?.attributes['o:title'] ?? ''
    const held = object && words === undefined ? await this.figures.object(part, program, alt) : undefined
    const figure = held ?? (await this.figures.picture(story.targets.get(target), alt, { width: lengthPixels(width), height: lengthPixels(height) }))
    if (figure === undefined) return undefined
    return { placed: { figure, alt, width: points(width), height: points(height) } }
  }

  /** A box of text: its size, fill and line from its shape's properties, the space inside its edges, and its paragraphs. */
  private async readBox(
    content: XmlNode,
    story: Story,
    size: { width: number; height: number },
    shape: XmlNode | undefined,
    body: XmlNode | undefined
  ): Promise<TextBox> {
    const fill = childAt(shape, 'a:solidFill')
    const line = childAt(shape, 'a:ln')
    const lineFill = childAt(line, 'a:solidFill')
    const drawingColor = (holder: XmlNode | undefined) => {
      const given = holder?.children.find((child) => child.name !== '#text')
      if (given?.name === 'a:srgbClr') return colorOf(given.attributes.val)
      if (given?.name === 'a:schemeClr') {
        const scheme = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[given.attributes.val ?? ''] ?? given.attributes.val ?? ''
        return this.context.theme.colors[scheme]
      }
      return undefined
    }
    const inset = (name: string, fallback: number) => emuPoints(body?.attributes[name]) ?? fallback
    const lineColor = drawingColor(lineFill)
    return {
      width: size.width || undefined,
      height: size.height || undefined,
      fill: drawingColor(fill),
      line: lineColor ? { width: emuPoints(line?.attributes.w) ?? 0.75, style: 'solid', color: lineColor } : undefined,
      insets: { top: inset('tIns', 3.6), right: inset('rIns', 7.2), bottom: inset('bIns', 3.6), left: inset('lIns', 7.2) },
      blocks: await this.readBlocks(content, { targets: story.targets, fields: [], width: size.width || story.width })
    }
  }

  // Tables

  /**
   * A table: its grid, its rows and cells with their style's looks, merged cells spanning their rows. At the top of
   * the body, a table is cut where Word last broke its pages, its heading rows written again on the next.
   */
  private async readTable(node: XmlNode, story: Story, top: boolean): Promise<DocumentTable[]> {
    const { context } = this
    const properties = childAt(node, 'w:tblPr')
    const chain = styleChain(context, value(childAt(properties, 'w:tblStyle')) ?? context.defaultTable, 'table')
    const looked = childAt(properties, 'w:tblLook')
    const flags = Number.parseInt(looked?.attributes['w:val'] ?? '0', 16) || 0
    const flag = (name: string, bit: number) => {
      const given = looked?.attributes[`w:${name}`]
      return given === undefined ? (flags & bit) !== 0 : given === '1' || given === 'true' || given === 'on'
    }
    const bandSize = (name: string) =>
      Math.max(
        1,
        Number(
          value(
            propertiesIn(chain, 'w:tblPr')
              .map((one) => childAt(one, name))
              .findLast(Boolean)
          )
        ) || 1
      )
    const style: TableStyle = {
      chain,
      look: {
        firstRow: flag('firstRow', 0x20),
        lastRow: flag('lastRow', 0x40),
        firstColumn: flag('firstColumn', 0x80),
        lastColumn: flag('lastColumn', 0x100),
        rowBands: !flag('noHBand', 0x200),
        columnBands: !flag('noVBand', 0x400)
      },
      rowBand: bandSize('w:tblStyleRowBandSize'),
      columnBand: bandSize('w:tblStyleColBandSize')
    }
    const tableProperties = [...propertiesIn(chain, 'w:tblPr'), ...(properties ? [properties] : [])]
    const last = (name: string) => tableProperties.map((one) => childAt(one, name)).findLast(Boolean)
    let borders: ReturnType<typeof sidesOf> = {}
    for (const one of tableProperties) borders = { ...borders, ...definedSides(sidesOf(childAt(one, 'w:tblBorders'), context, true)) }
    let margins: Sides<number> = {}
    for (const one of tableProperties) margins = overSides(margins, insetsOf(childAt(one, 'w:tblCellMar')))
    const tableShading = shadingOf(last('w:shd'), context)

    const grid = childrenNamed(childAt(node, 'w:tblGrid'), 'w:gridCol').map((column) => twips(column.attributes['w:w']) ?? 0)
    const rowsRead = [...unwrapped(node)].filter((child) => child.name === 'w:tr')
    const columns = Math.max(
      grid.length,
      ...rowsRead.map((row) => {
        const before = Number(value(childAt(row, 'w:trPr', 'w:gridBefore'))) || 0
        return before + [...unwrapped(row)].filter((child) => child.name === 'w:tc').reduce((sum, cell) => sum + span(cell), 0)
      })
    )
    const rows: DocumentTable['rows'] = []
    const places: { cell: TableCell; column: number; row: number }[][] = []
    const heading: boolean[] = []
    const breaks: boolean[] = []
    const merging = new Map<number, TableCell>()
    for (const [rowIndex, row] of rowsRead.entries()) {
      if (this.full) {
        this.cut = true
        break
      }
      this.blocks++
      const rowProperties = childAt(row, 'w:trPr')
      const height = childAt(rowProperties, 'w:trHeight')
      const heightValue = twips(height?.attributes['w:val'])
      const cells: TableCell[] = []
      const placed: { cell: TableCell; column: number; row: number }[] = []
      let column = Number(value(childAt(rowProperties, 'w:gridBefore'))) || 0
      if (column > 0) cells.push({ columns: column, rows: 1, borders: {}, insets: {}, blocks: [] })
      for (const cellNode of [...unwrapped(row)].filter((child) => child.name === 'w:tc')) {
        const cellProperties = childAt(cellNode, 'w:tcPr')
        const spanned = span(cellNode)
        const merge = childAt(cellProperties, 'w:vMerge')
        const kinds = cellKinds({ row: rowIndex, rows: rowsRead.length, column, columns, span: spanned }, style)
        const conditional = kinds.flatMap((kind) => kindElements(style, kind))
        if (merge && (merge.attributes['w:val'] ?? 'continue') === 'continue') {
          const above = merging.get(column)
          if (above) {
            above.rows++
            column += spanned
            // Its content, if any, is read for the counts of lists, and left out, as Word shows it.
            continue
          }
        }
        const cellLooks = propertiesIn(conditional, 'w:tcPr')
        let shading = tableShading
        for (const one of cellLooks) shading = shadingOf(childAt(one, 'w:shd'), context) ?? shading
        if (childAt(cellProperties, 'w:shd')) shading = shadingOf(childAt(cellProperties, 'w:shd'), context)
        // Its borders: the table's at its edges and between cells, its style's looks', then its own.
        const edge = {
          top: rowIndex === 0 ? borders.top : borders.insideH,
          bottom: rowIndex === rowsRead.length - 1 ? borders.bottom : borders.insideH,
          left: column === 0 ? borders.left : borders.insideV,
          right: column + spanned >= columns ? borders.right : borders.insideV
        }
        let sides: Sides<BorderLook> = edge
        for (const kind of kinds.slice(1)) {
          for (const one of propertiesIn(kindElements(style, kind), 'w:tcPr')) {
            const given = sidesOf(childAt(one, 'w:tcBorders'), context, true)
            sides = overSides(sides, definedSides({ top: given.top, bottom: given.bottom }))
            sides = overSides(
              sides,
              definedSides({ left: column === 0 ? given.left : given.insideV, right: column + spanned >= columns ? given.right : given.insideV })
            )
          }
        }
        sides = overSides(sides, definedSides(sidesOf(childAt(cellProperties, 'w:tcBorders'), context)))
        let insets = margins
        insets = overSides(insets, insetsOf(childAt(cellProperties, 'w:tcMar')))
        const vertical = value(childAt(cellProperties, 'w:vAlign'))
        const cell: TableCell = {
          columns: spanned,
          rows: 1,
          shading,
          borders: sides,
          insets,
          vertical: vertical === 'center' ? 'middle' : vertical === 'bottom' ? 'bottom' : undefined,
          blocks: await this.readBlocks(cellNode, story, { style, kinds })
        }
        if (merge) merging.set(column, cell)
        else merging.delete(column)
        cells.push(cell)
        placed.push({ cell, column, row: rowIndex })
        column += spanned
      }
      const header = childAt(rowProperties, 'w:tblHeader')
      heading.push(header !== undefined && toggled(header) && heading.every(Boolean))
      breaks.push(
        top &&
          rowIndex > 0 &&
          findNode(row, (one) => one.name === 'w:lastRenderedPageBreak' || (one.name === 'w:br' && one.attributes['w:type'] === 'page')) !== undefined
      )
      rows.push({ height: heightValue ? { value: heightValue, exact: height?.attributes['w:hRule'] === 'exact' } : undefined, cells })
      places.push(placed)
    }

    const align = value(last('w:jc'))
    const indent = twips(last('w:tblInd')?.attributes['w:w'])
    // Word 2013 and later measure a table's indent to its edge; earlier, to its first cell's text.
    const outdent = context.compatibility >= 15 ? 0 : (margins.left ?? 5.4)
    const widths = grid.length >= columns ? grid : [...grid, ...Array.from({ length: columns - grid.length }, () => 0)]
    const table = (part: DocumentTable['rows']): DocumentTable => ({
      kind: 'table',
      columns: widths,
      align: align === 'center' ? 'center' : align === 'right' || align === 'end' ? 'right' : undefined,
      indent: (indent ?? 0) - outdent || undefined,
      rows: part
    })
    // Cut where the pages broke: a cell spanning rows across the cut goes on in an empty one.
    const starts = breaks.flatMap((broken, index) => (broken ? [index] : []))
    if (starts.length === 0) return [table(rows)]
    const tables: DocumentTable[] = []
    const heads = rows.filter((_, index) => heading[index])
    let from = 0
    for (const end of [...starts, rows.length]) {
      const part = rows.slice(from, end).map((row, offset) => {
        const index = from + offset
        const cells = row.cells.map((cell) => ({ ...cell, rows: Math.min(cell.rows, end - index) }))
        if (offset > 0) return { ...row, cells }
        // Cells from above that span into this row.
        const carried = places
          .slice(0, index)
          .flat()
          .filter((place) => place.row + place.cell.rows > index)
          .map((place) => ({ column: place.column, cell: { ...place.cell, blocks: [], rows: Math.min(place.row + place.cell.rows, end) - index } }))
        const own = places[index] ?? []
        const ordered = [...own.map((place) => ({ column: place.column, cell: cells[row.cells.indexOf(place.cell)] ?? place.cell })), ...carried].sort(
          (one, other) => one.column - other.column
        )
        const before = row.cells.length > own.length ? cells.slice(0, row.cells.length - own.length) : []
        return { ...row, cells: [...before, ...ordered.map((one) => one.cell)] }
      })
      tables.push(table(from > 0 && !heading[from] ? [...heads, ...part] : part))
      from = end
    }
    return tables
  }

  // Headers and footers

  private readonly stories = new Map<string, Promise<DocumentBlock[]>>()

  /** A header's or a footer's blocks, its part read once. */
  storyBlocks(part: string | undefined, width: number): Promise<DocumentBlock[]> {
    if (part === undefined) return Promise.resolve([])
    let read = this.stories.get(part)
    if (!read) {
      read = (async () => {
        const xml = await textOf(this.archive, part)
        const root = xmlTree(xml ?? '').children.find((child) => child.name === 'w:hdr' || child.name === 'w:ftr')
        if (!root) return []
        return this.readBlocks(root, { targets: await relationships(this.archive, part), fields: [], width })
      })()
      this.stories.set(part, read)
    }
    return read
  }
}

/** How many grid columns a cell spans. */
const span = (cell: XmlNode) => Math.max(1, Number(value(childAt(cell, 'w:tcPr', 'w:gridSpan'))) || 1)

/** The sides given, those not given left out, so they do not hide those under them. */
function definedSides<Value>(sides: Record<string, Value | undefined>): Record<string, Value> {
  return Object.fromEntries(Object.entries(sides).filter(([, one]) => one !== undefined)) as Record<string, Value>
}

/** The space inside a cell's edges, as a table's or a cell's margins give it. */
function insetsOf(node: XmlNode | undefined): Sides<number> {
  const side = (...names: string[]) => {
    const found = names.map((name) => childAt(node, name)).find(Boolean)
    return found && (found.attributes['w:type'] ?? 'dxa') === 'dxa' ? twips(found.attributes['w:w']) : undefined
  }
  return { top: side('w:top'), right: side('w:right', 'w:end'), bottom: side('w:bottom'), left: side('w:left', 'w:start') }
}

/** The first element in another, at any depth, that a test finds. */
function findNode(node: XmlNode | undefined, test: (one: XmlNode) => boolean, depth = 0): XmlNode | undefined {
  if (!node || depth > 40) return undefined
  for (const child of node.children) {
    if (test(child)) return child
    const found = findNode(child, test, depth + 1)
    if (found) return found
  }
  return undefined
}

/** The page's number or the count of pages, for the fields that write them. */
function fieldKind(instruction: string): 'page' | 'pages' | undefined {
  const name = /^\s*(\w+)/.exec(instruction)?.[1]?.toUpperCase()
  return name === 'PAGE' ? 'page' : name === 'NUMPAGES' || name === 'SECTIONPAGES' ? 'pages' : undefined
}

/** Where a field of a link leads: its address, or a place in the document. */
function fieldTarget(instruction: string): string | undefined {
  const found = /^\s*HYPERLINK\s+(\\l\s+)?"([^"]*)"/i.exec(instruction)
  if (!found) return undefined
  return found[1] ? `#${found[2]}` : found[2]
}

/** A run's look as the look keeps it, without what reading needs. */
function strip(look: RunRead): TextLook {
  const { hidden: _hidden, ...kept } = look
  return kept
}

/**
 * A Word document's look: its pages as its sections lay them out and as Word last broke them, each with its header,
 * footer and footnotes, and its endnotes at the end. Its figures are added to those of its text, the same picture once.
 */
export async function readWordLook(archive: Archive, figures: Figures): Promise<{ look: DocumentLook; cut: boolean } | undefined> {
  const xml = await textOf(archive, 'word/document.xml')
  if (xml === undefined) return undefined
  const document = childAt(xmlTree(xml), 'w:document')
  const body = childAt(document, 'w:body')
  if (!body) return undefined
  const targets = await relationships(archive, 'word/document.xml')
  const find = (pattern: RegExp) => [...targets.values()].find((target) => pattern.test(target))
  const settings = xmlTree((await textOf(archive, find(/settings\.xml$/i) ?? 'word/settings.xml')) ?? '')
  const settingsRoot = childAt(settings, 'w:settings')
  const theme = readTheme(await textOf(archive, find(/theme\/[^/]+\.xml$/i) ?? 'word/theme/theme1.xml'), childAt(settingsRoot, 'w:clrSchemeMapping'))

  const stylesRoot = childAt(xmlTree((await textOf(archive, find(/styles\.xml$/i) ?? 'word/styles.xml')) ?? ''), 'w:styles')
  const styles = new Map<string, XmlNode>()
  let defaultParagraph: string | undefined
  let defaultTable: string | undefined
  for (const style of childrenNamed(stylesRoot, 'w:style')) {
    const id = style.attributes['w:styleId'] ?? ''
    styles.set(id, style)
    const isDefault = style.attributes['w:default'] === '1' || style.attributes['w:default'] === 'true'
    if (isDefault && (style.attributes['w:type'] ?? 'paragraph') === 'paragraph') defaultParagraph ??= id
    if (isDefault && style.attributes['w:type'] === 'table') defaultTable ??= id
  }
  const defaults = childAt(stylesRoot, 'w:docDefaults')
  const compatibility = Number(
    childrenNamed(childAt(settingsRoot, 'w:compat'), 'w:compatSetting').find((setting) => setting.attributes['w:name'] === 'compatibilityMode')?.attributes[
      'w:val'
    ]
  )
  const context: Context = {
    theme,
    styles,
    defaults: { run: childAt(defaults, 'w:rPrDefault', 'w:rPr'), paragraph: childAt(defaults, 'w:pPrDefault', 'w:pPr') },
    defaultParagraph,
    defaultTable,
    numbering: new Numbering(await textOf(archive, find(/numbering\.xml$/i) ?? 'word/numbering.xml'), styles),
    tab: within(twips(value(childAt(settingsRoot, 'w:defaultTabStop'))) ?? 36, 9, 288),
    compatibility: Number.isFinite(compatibility) ? compatibility : 12
  }

  // The sections, each ended by a paragraph that holds its properties, the last by the body's.
  const sections: Section[] = []
  for (const child of unwrapped(body)) {
    const found = child.name === 'w:p' ? childAt(child, 'w:pPr', 'w:sectPr') : child.name === 'w:sectPr' ? child : undefined
    if (found) sections.push(sectionOf(found, sections.at(-1)))
  }
  if (sections.length === 0) sections.push(sectionOf(undefined, undefined))

  const notePart = async (pattern: RegExp, fallback: string) => {
    const part = find(pattern) ?? fallback
    const text = await textOf(archive, part)
    return {
      root: text === undefined ? undefined : xmlTree(text).children.find((child) => child.name !== '#text'),
      targets: await relationships(archive, part)
    }
  }
  const foot = await notePart(/footnotes\.xml$/i, 'word/footnotes.xml')
  const end = await notePart(/endnotes\.xml$/i, 'word/endnotes.xml')
  const reader = new WordReader(archive, figures, context, sections, { foot: foot.root, end: end.root, footTargets: foot.targets, endTargets: end.targets })
  const story: Story = { targets, fields: [], width: reader.textWidth(sections[0]) }
  await reader.readBody(body, story)
  if (reader.pages.length === 0) reader.pages.push({ section: 0, bands: [{ section: 0, columns: 1, gap: 36, blocks: [] }], notes: [] })

  const evenAndOdd = childAt(settingsRoot, 'w:evenAndOddHeaders') !== undefined
  const pages: DocumentPage[] = []
  let number = 0
  let previous = -1
  for (const page of reader.pages) {
    const section = sections[page.section] ?? (sections[0] as Section)
    const first = page.section !== previous
    if (first && section.start !== undefined) number = section.start - 1
    previous = page.section
    number++
    const kind = first && section.titlePage ? 'first' : evenAndOdd && number % 2 === 0 ? 'even' : 'default'
    const width = reader.textWidth(section)
    // A first or even page whose kind of header its section does not give has none.
    const header = await reader.storyBlocks(targets.get(section.headers.get(kind) ?? ''), width)
    const footer = await reader.storyBlocks(targets.get(section.footers.get(kind) ?? ''), width)
    pages.push({
      width: section.width,
      height: section.height,
      number: section.format === 'decimal' ? String(number) : listMark(section.format, number),
      margins: section.margins,
      header,
      footer,
      notes: page.notes,
      bands: page.bands.map(({ section: _section, ...band }) => band)
    })
  }
  const paper = colorOf(childAt(document, 'w:background')?.attributes['w:color'])
  let text: RunRead = {}
  if (context.defaults.run) text = runLook(context.defaults.run, text, context)
  for (const style of styleChain(context, defaultParagraph, 'paragraph')) text = runLook(childAt(style, 'w:rPr'), text, context)
  return { look: { pages, paper, endNotes: reader.endNotesRead, text: strip(text), tab: context.tab }, cut: reader.cut }
}
