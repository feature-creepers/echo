/**
 * The geometry of an OpenDocument custom shape (`draw:enhanced-geometry`, docs/SPEC.md, section 9.7): a path of
 * commands (`draw:enhanced-path`) whose numbers may be the shape's adjustments (`$0`), its equations (`?f0`) or the
 * edges of its view box (`left`, `bottom`…), each equation a formula of numbers, operators and functions. The path is
 * drawn by `custom-geometry.ts`, with the commands OfficeArt's paths share. A shape that gives no path but a kind
 * (`draw:type`) is drawn as that kind is.
 *
 * Formulas are read without `eval`: a small parser of their grammar, each equation worked out once, a loop of
 * equations naming each other taken as zero.
 */

import { type CustomGeometry, customGeometry, type PathCommand, type ViewBox } from './custom-geometry.ts'
import { presetPath } from './slide-svg.ts'
import type { XmlNode } from './xml.ts'

/** The kinds of OpenDocument's own shapes, as DrawingML names them, for a shape that gives no path. */
const KINDS: Record<string, string> = {
  rectangle: 'rect',
  'round-rectangle': 'roundRect',
  ellipse: 'ellipse',
  circle: 'ellipse',
  diamond: 'diamond',
  'isosceles-triangle': 'triangle',
  'right-triangle': 'rtTriangle',
  parallelogram: 'parallelogram',
  trapezoid: 'trapezoid',
  hexagon: 'hexagon',
  octagon: 'octagon',
  cross: 'plus',
  star4: 'star4',
  star5: 'star5',
  star8: 'star8',
  'right-arrow': 'rightArrow',
  'left-arrow': 'leftArrow',
  pentagon: 'homePlate',
  chevron: 'chevron',
  ring: 'donut',
  'flowchart-process': 'rect',
  'flowchart-decision': 'diamond',
  'flowchart-terminator': 'flowChartTerminator',
  'flowchart-connector': 'ellipse'
}

/** The numbers a formula names beyond its own: the view box's edges and size, and the shape's size in hundredths of a millimetre. */
interface Context {
  view: ViewBox
  width: number
  height: number
  modifiers: number[]
  equation: (name: string) => number
}

/** A formula's tokens: numbers, names, `?` and `$` references, operators and brackets. */
function tokens(formula: string): string[] {
  return formula.match(/\d*\.?\d+(?:[eE][-+]?\d+)?|\?[A-Za-z_]\w*|\$\d+|[A-Za-z_]\w*|[-+*/(),]/g) ?? []
}

/** A name of the formula language: a constant of the view box or the shape. */
function named(name: string, context: Context): number {
  const { view } = context
  switch (name) {
    case 'pi':
      return Math.PI
    case 'left':
      return view.left
    case 'top':
      return view.top
    case 'right':
      return view.left + view.width
    case 'bottom':
      return view.top + view.height
    case 'width':
      return view.width
    case 'height':
      return view.height
    case 'logwidth':
      return context.width
    case 'logheight':
      return context.height
    case 'hasstroke':
    case 'hasfill':
      return 1
    default:
      return 0
  }
}

/** A value of a path or a formula: a number, an equation, an adjustment or a constant. */
function parameter(token: string, context: Context): number {
  if (token.startsWith('?')) return context.equation(token.slice(1))
  if (token.startsWith('$')) return context.modifiers[Number(token.slice(1))] ?? 0
  const value = Number(token)
  return Number.isFinite(value) ? value : named(token, context)
}

const FUNCTIONS: Record<string, (...values: number[]) => number> = {
  abs: (value = 0) => Math.abs(value),
  sqrt: (value = 0) => Math.sqrt(Math.max(0, value)),
  sin: (value = 0) => Math.sin(value),
  cos: (value = 0) => Math.cos(value),
  tan: (value = 0) => Math.tan(value),
  atan: (value = 0) => Math.atan(value),
  atan2: (x = 0, y = 0) => Math.atan2(y, x),
  min: (one = 0, other = 0) => Math.min(one, other),
  max: (one = 0, other = 0) => Math.max(one, other),
  if: (condition = 0, yes = 0, no = 0) => (condition > 0 ? yes : no)
}

/** A formula worked out: sums of products of factors, a factor a value, a function, a bracket or a negation. */
export function evaluate(formula: string, context: Context): number {
  const list = tokens(formula)
  let at = 0
  const sum = (): number => {
    let value = product()
    while (list[at] === '+' || list[at] === '-') value = list[at++] === '+' ? value + product() : value - product()
    return value
  }
  const product = (): number => {
    let value = factor()
    while (list[at] === '*' || list[at] === '/') {
      if (list[at++] === '*') value *= factor()
      else {
        const divisor = factor()
        value = divisor === 0 ? 0 : value / divisor
      }
    }
    return value
  }
  const factor = (): number => {
    const token = list[at++]
    if (token === undefined) return 0
    if (token === '-') return -factor()
    if (token === '+') return factor()
    if (token === '(') {
      const value = sum()
      if (list[at] === ')') at++
      return value
    }
    const call = FUNCTIONS[token]
    if (call && list[at] === '(') {
      at++
      const values: number[] = []
      while (at < list.length && list[at] !== ')') {
        values.push(sum())
        if (list[at] === ',') at++
        else if (list[at] !== ')') break
      }
      at++
      return call(...values)
    }
    return parameter(token, context)
  }
  const value = sum()
  return Number.isFinite(value) ? value : 0
}

/** The letters of the path's commands. */
const COMMANDS = new Set(['M', 'L', 'C', 'Z', 'N', 'F', 'S', 'T', 'U', 'A', 'B', 'V', 'W', 'X', 'Y', 'Q', 'G'])

/** A path's commands with their numbers worked out; commands of other letters are passed over with their numbers. */
export function pathCommands(path: string, context: Context): PathCommand[] {
  const commands: PathCommand[] = []
  for (const token of path.match(/[A-Za-z]\w*|\?\w+|\$\d+|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []) {
    if (/^[A-Z]$/.test(token)) commands.push({ command: COMMANDS.has(token) ? token : '', values: [] })
    else commands.at(-1)?.values.push(parameter(token, context))
  }
  return commands.filter((command) => command.command !== '')
}

/** A shape's geometry drawn in its box of pixels, and the box its text is written in. */
export interface EnhancedGeometry {
  geometry: CustomGeometry
  text?: { x: number; y: number; width: number; height: number } | undefined
  flipH: boolean
  flipV: boolean
}

/** Hundredths of a millimetre to a pixel, as LibreOffice measures a shape for its formulas. */
const LOGICAL_PER_PIXEL = 2540 / 96

/** A custom shape's geometry (`draw:enhanced-geometry`) in a box of `size` pixels. */
export function enhancedGeometry(node: XmlNode, size: { width: number; height: number }): EnhancedGeometry {
  const { attributes } = node
  const box = (attributes['svg:viewBox'] ?? '0 0 21600 21600')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const view: ViewBox = {
    left: box[0] || 0,
    top: box[1] || 0,
    width: Number.isFinite(box[2]) ? (box[2] as number) : 21_600,
    height: Number.isFinite(box[3]) ? (box[3] as number) : 21_600
  }
  const modifiers = (attributes['draw:modifiers'] ?? '')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((value) => Number(value) || 0)
  const formulas = new Map<string, string>()
  for (const child of node.children)
    if (child.name === 'draw:equation' && child.attributes['draw:name']) formulas.set(child.attributes['draw:name'], child.attributes['draw:formula'] ?? '0')
  const known = new Map<string, number>()
  const working = new Set<string>()
  const context: Context = {
    view,
    width: size.width * LOGICAL_PER_PIXEL,
    height: size.height * LOGICAL_PER_PIXEL,
    modifiers,
    equation: (name) => {
      const found = known.get(name)
      if (found !== undefined) return found
      const formula = formulas.get(name)
      // An equation that names itself, through others or not, is zero.
      if (formula === undefined || working.has(name) || working.size > 256) return 0
      working.add(name)
      const value = evaluate(formula, context)
      working.delete(name)
      known.set(name, value)
      return value
    }
  }
  const path = attributes['draw:enhanced-path']
  const flipH = attributes['draw:mirror-horizontal'] === 'true'
  const flipV = attributes['draw:mirror-vertical'] === 'true'
  let geometry: CustomGeometry
  if (path) geometry = customGeometry(pathCommands(path, context), view, size)
  else {
    const preset = presetPath(KINDS[attributes['draw:type'] ?? ''] ?? 'rect', size.width, size.height, (_, fallback) => fallback)
    geometry = { fill: preset.closed ? preset.data : '', stroke: preset.data }
  }
  // The box its text is written in: the first of its text areas, in its view box.
  let text: EnhancedGeometry['text']
  const areas = attributes['draw:text-areas']
  if (path && areas) {
    const values = pathCommands(`M ${areas}`, context)[0]?.values ?? []
    if (values.length >= 4) {
      const scaleX = view.width ? size.width / view.width : 0
      const scaleY = view.height ? size.height / view.height : 0
      const [left, top, right, bottom] = values as [number, number, number, number]
      text = {
        x: (Math.min(left, right) - view.left) * scaleX,
        y: (Math.min(top, bottom) - view.top) * scaleY,
        width: Math.abs(right - left) * scaleX,
        height: Math.abs(bottom - top) * scaleY
      }
    }
  }
  return { geometry, text, flipH, flipV }
}
