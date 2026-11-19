/**
 * The equations of Word 2007 and later (Office Math, `m:oMath`) as linear text a preview can show (docs/SPEC.md,
 * section 9.7), close to the linear format Word itself writes: a fraction as a/b, a power or an index in superscript or
 * subscript characters where Unicode has them and after ^ or _ where it does not, a root as √, a sum or an integral
 * with its limits, brackets, functions, accents, limits, matrices and arrays of equations. Parts of more than one
 * symbol are grouped in brackets, so the text reads as the equation does.
 */

import type { XmlEvent } from './xml.ts'

/** An element of an equation, with its attributes, the elements in it and its text. */
interface MathNode {
  name: string
  attributes: Record<string, string>
  children: MathNode[]
  text: string
}

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ'
}

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ'
}

/** The deepest an equation is read: past it, an element's text is left out. */
const DEPTH_LIMIT = 64

/** The elements an equation's events make, from the first opened to the last closed. */
function tree(events: readonly XmlEvent[]): MathNode {
  const root: MathNode = { name: '', attributes: {}, children: [], text: '' }
  const open: MathNode[] = [root]
  for (const event of events) {
    const parent = open.at(-1) as MathNode
    if (event.type === 'open') {
      const node: MathNode = { name: event.name, attributes: event.attributes, children: [], text: '' }
      parent.children.push(node)
      if (open.length < DEPTH_LIMIT) open.push(node)
    } else if (event.type === 'close') {
      if (open.length > 1 && parent.name === event.name) open.pop()
    } else parent.children.push({ name: '#text', attributes: {}, children: [], text: event.text })
  }
  return root
}

const childOf = (node: MathNode | undefined, name: string) => node?.children.find((child) => child.name === name)
const childrenOf = (node: MathNode, name: string) => node.children.filter((child) => child.name === name)

/** A property of an element, from its element of properties (`m:fPr`, `m:dPr`…): its value, or none. */
const property = (node: MathNode, properties: string, name: string): string | undefined => childOf(childOf(node, properties), name)?.attributes['m:val']

/** Whether a property that switches something on is on: present with no value, or `1`, `on` or `true`. */
const switchedOn = (node: MathNode, properties: string, name: string) => {
  const found = childOf(childOf(node, properties), name)
  if (!found) return false
  const value = found.attributes['m:val']
  return value === undefined || value === '1' || value === 'on' || value === 'true'
}

/**
 * Whether a part reads as one symbol, needing no brackets around it: one character, a number, or a part in brackets
 * already. Letters side by side are a product, grouped.
 */
const single = (text: string) => [...text].length <= 1 || /^\d+([.,]\d+)?$/.test(text) || /^\(.*\)$|^\[.*\]$|^\{.*\}$/u.test(text)

const grouped = (text: string) => (single(text) ? text : `(${text})`)

/** A part raised or lowered: in superscript or subscript characters when Unicode has each, else after ^ or _. */
function script(base: string, text: string, raised: boolean): string {
  if (text === '') return base
  const characters = raised ? SUPERSCRIPTS : SUBSCRIPTS
  const letters = [...text]
  if (letters.every((letter) => characters[letter] !== undefined)) return base + letters.map((letter) => characters[letter]).join('')
  return `${base}${raised ? '^' : '_'}${grouped(text)}`
}

/** The text of an element's argument, `m:e`, or of the part named. */
const part = (node: MathNode, name = 'm:e') => {
  const found = childOf(node, name)
  return found ? render(found) : ''
}

function render(node: MathNode): string {
  switch (node.name) {
    case '#text':
      return node.text
    case 'm:r':
      return childrenOf(node, 'm:t').map(render).join('')
    case 'm:f': {
      const numerator = part(node, 'm:num')
      const denominator = part(node, 'm:den')
      // A fraction of no bar is a binomial coefficient.
      if (property(node, 'm:fPr', 'm:type') === 'noBar') return `(${numerator} ¦ ${denominator})`
      return `${grouped(numerator)}/${grouped(denominator)}`
    }
    case 'm:sSup':
      return script(grouped(part(node)), part(node, 'm:sup'), true)
    case 'm:sSub':
      return script(grouped(part(node)), part(node, 'm:sub'), false)
    case 'm:sSubSup':
      return script(script(grouped(part(node)), part(node, 'm:sub'), false), part(node, 'm:sup'), true)
    case 'm:sPre':
      return script(script('', part(node, 'm:sub'), false), part(node, 'm:sup'), true) + part(node)
    case 'm:rad': {
      const degree = switchedOn(node, 'm:radPr', 'm:degHide') ? '' : part(node, 'm:deg')
      const sign = degree === '' || degree === '2' ? '√' : degree === '3' ? '∛' : degree === '4' ? '∜' : `${script('', degree, true)}√`
      return sign + grouped(part(node))
    }
    case 'm:nary': {
      const sign = property(node, 'm:naryPr', 'm:chr') ?? '∫'
      const lower = switchedOn(node, 'm:naryPr', 'm:subHide') ? '' : part(node, 'm:sub')
      const upper = switchedOn(node, 'm:naryPr', 'm:supHide') ? '' : part(node, 'm:sup')
      const limits = `${lower === '' ? '' : `_${grouped(lower)}`}${upper === '' ? '' : `^${grouped(upper)}`}`
      return `${sign}${limits} ${part(node)}`.trimEnd()
    }
    case 'm:d': {
      const opening = property(node, 'm:dPr', 'm:begChr') ?? '('
      const closing = property(node, 'm:dPr', 'm:endChr') ?? ')'
      const separator = property(node, 'm:dPr', 'm:sepChr') ?? '|'
      return `${opening}${childrenOf(node, 'm:e').map(render).join(separator)}${closing}`
    }
    case 'm:func': {
      const argument = part(node)
      return `${part(node, 'm:fName')}${/^[([{]/.test(argument) ? '' : ' '}${argument}`
    }
    case 'm:acc':
      return part(node) + (property(node, 'm:accPr', 'm:chr') ?? '̂')
    case 'm:bar':
      return part(node) + (property(node, 'm:barPr', 'm:pos') === 'top' ? '̅' : '̲')
    case 'm:limLow':
      return `${part(node)}_${grouped(part(node, 'm:lim'))}`
    case 'm:limUpp':
      return `${part(node)}^${grouped(part(node, 'm:lim'))}`
    case 'm:m':
      return `[${childrenOf(node, 'm:mr')
        .map((row) => childrenOf(row, 'm:e').map(render).join(' '))
        .join('; ')}]`
    case 'm:eqArr':
      return childrenOf(node, 'm:e').map(render).join('; ')
    default:
      // Properties are not text; any other element is its parts in order.
      if (/Pr$/.test(node.name) || node.name === 'm:ctrlPr') return ''
      return node.children.map(render).join('')
  }
}

/** An equation's events, from its `m:oMath` to its end, as linear text. */
export function mathText(events: readonly XmlEvent[]): string {
  return render(tree(events)).replace(/\s+/g, ' ').trim()
}

// MathML

/** An element's name without its prefix: `math:mfrac` and `mfrac` alike. */
const local = (node: MathNode) => node.name.replace(/^[^:]*:/, '')

/** The elements in an element, its text left out when it holds elements: MathML's layout is in its elements. */
const parts = (node: MathNode) => node.children.filter((child) => child.name !== '#text')

/** A space after a sum, a product or an integral with its limits, before what it applies to, as Word writes one. */
const apart = (base: string) => (/^[∑∏∐∫∬∭∮⋃⋂⋁⋀]$/u.test(base) ? ' ' : '')

/** An element of MathML, as Word's equations are written: a fraction as a/b, scripts raised and lowered, roots, limits, brackets and tables. */
function renderMathMl(node: MathNode, depth = 0): string {
  if (depth > DEPTH_LIMIT) return ''
  const inner = (child: MathNode | undefined) => (child ? renderMathMl(child, depth + 1) : '')
  const [first, second, third] = parts(node)
  switch (local(node)) {
    case '#text':
      return node.text
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return node.children.map((child) => (child.name === '#text' ? child.text : inner(child))).join('')
    case 'annotation':
    case 'annotation-xml':
    case 'mphantom':
    case 'mspace':
    case 'none':
      return ''
    case 'semantics':
      return inner(first)
    case 'mfrac':
      // A fraction of no line is a binomial coefficient.
      if (node.attributes.linethickness === '0' || node.attributes['math:linethickness'] === '0') return `(${inner(first)} ¦ ${inner(second)})`
      return `${grouped(inner(first))}/${grouped(inner(second))}`
    case 'msup':
      return script(grouped(inner(first)), inner(second), true)
    case 'msub':
      return script(grouped(inner(first)), inner(second), false)
    case 'msubsup':
      return script(script(grouped(inner(first)), inner(second), false), inner(third), true)
    case 'msqrt':
      return `√${grouped(parts(node).map(inner).join(''))}`
    case 'mroot': {
      const degree = inner(second)
      const sign = degree === '' || degree === '2' ? '√' : degree === '3' ? '∛' : degree === '4' ? '∜' : `${script('', degree, true)}√`
      return sign + grouped(inner(first))
    }
    case 'munder':
      return `${inner(first)}_${grouped(inner(second))}${apart(inner(first))}`
    case 'mover':
      return `${inner(first)}^${grouped(inner(second))}${apart(inner(first))}`
    case 'munderover':
      return `${inner(first)}_${grouped(inner(second))}^${grouped(inner(third))}${apart(inner(first))}`
    case 'mfenced': {
      const attribute = (name: string, fallback: string) => node.attributes[name] ?? node.attributes[`math:${name}`] ?? fallback
      return `${attribute('open', '(')}${parts(node)
        .map(inner)
        .join(attribute('separators', ',').trim().charAt(0) || ',')}${attribute('close', ')')}`
    }
    case 'mtable':
      return `[${parts(node)
        .map((row) => parts(row).map(inner).join(' '))
        .join('; ')}]`
    default:
      return parts(node).map(inner).join('')
  }
}

/** A MathML equation's events, from its `math` element to its end, as linear text. */
export function mathMlText(events: readonly XmlEvent[]): string {
  return renderMathMl(tree(events)).replace(/\s+/g, ' ').trim()
}
