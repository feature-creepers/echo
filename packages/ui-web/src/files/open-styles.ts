/**
 * OpenDocument's styles, read for drawing a file as it looks (docs/SPEC.md, section 9.7), whatever kind of file it is:
 * lengths as its formats write them, the styles of a part by family and name, each taking what it leaves out from the
 * one it comes from, then from its family's default, and the fonts its faces name.
 */

import { childAt, childrenNamed, type XmlNode } from './xml.ts'

const UNITS: Record<string, number> = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 4 / 3, pc: 16, px: 1 }

/** A length as OpenDocument writes it ("2.5cm", "72pt") in pixels; none when it is no length. */
export function length(value: string | undefined): number | undefined {
  const match = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)\s*(in|cm|mm|pt|pc|px)?\s*$/i.exec(value ?? '')
  if (!match) return undefined
  const found = Number(match[1]) * (UNITS[(match[2] ?? 'px').toLowerCase()] ?? 1)
  return Number.isFinite(found) ? found : undefined
}

/** A share written as a percentage ("45%"), from 0 to 1; none when it is none. */
export const share = (value: string | undefined) => {
  const match = /^\s*(-?\d*\.?\d+)\s*%\s*$/.exec(value ?? '')
  return match ? Number(match[1]) / 100 : undefined
}

/** The properties an element of properties gives, by their names. */
export type Properties = Record<string, string>

/**
 * A part's styles merged in order, a later one over an earlier: a size given as a share of the one under it
 * (`fo:font-size="120%"`) is worked out against it.
 */
export function merged(layers: readonly Properties[]): Properties {
  const result: Properties = {}
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      if (name === 'fo:font-size') {
        const relative = share(value)
        const under = length(result[name])
        if (relative !== undefined) {
          if (under !== undefined) result[name] = `${(under * relative * 3) / 4}pt`
          else if (result[name] === undefined) result[name] = value
          continue
        }
      }
      result[name] = value
    }
  }
  return result
}

/**
 * The styles of a presentation, by family and name: the automatic ones of its content, those of its master pages,
 * then its common ones, each family with its default. Lists' styles are found by name among them all.
 */
export class StyleBook {
  private readonly pools: { content: Map<string, XmlNode>; masters: Map<string, XmlNode>; common: Map<string, XmlNode> }
  private readonly defaults = new Map<string, XmlNode>()
  readonly lists = new Map<string, XmlNode>()
  readonly templates = new Map<string, XmlNode>()
  private readonly cache = new Map<string, Properties>()

  constructor(content: XmlNode | undefined, masters: XmlNode | undefined, common: XmlNode | undefined) {
    const pool = (node: XmlNode | undefined) => {
      const found = new Map<string, XmlNode>()
      for (const child of node?.children ?? []) {
        const name = child.attributes['style:name']
        if (child.name === 'style:style' && name) found.set(`${child.attributes['style:family']}/${name}`, child)
        else if (child.name === 'text:list-style' && name && !this.lists.has(name)) this.lists.set(name, child)
        else if (child.name === 'style:default-style') this.defaults.set(child.attributes['style:family'] ?? '', child)
        else if (child.name === 'table:table-template') this.templates.set(child.attributes['table:name'] ?? child.attributes['text:style-name'] ?? '', child)
      }
      return found
    }
    this.pools = { content: pool(content), masters: pool(masters), common: pool(common) }
  }

  /** A style by family and name: the content's own first, unless it is a master's, then the masters', then the common ones. */
  find(family: string, name: string | undefined, inMaster: boolean): XmlNode | undefined {
    if (!name) return undefined
    const key = `${family}/${name}`
    return (inMaster ? undefined : this.pools.content.get(key)) ?? this.pools.masters.get(key) ?? this.pools.common.get(key)
  }

  /** The name of the style a person chose: a style of the content's own, which the app made for a paragraph, stands for the one it comes from. */
  chosen(family: string, name: string | undefined): string | undefined {
    const own = name === undefined ? undefined : this.pools.content.get(`${family}/${name}`)
    return own?.attributes['style:parent-style-name'] ?? name
  }

  /** A style and those it comes from, the farthest first. */
  chain(family: string, name: string | undefined, inMaster: boolean): XmlNode[] {
    const found: XmlNode[] = []
    let style = this.find(family, name, inMaster)
    while (style && found.length < 32 && !found.includes(style)) {
      found.unshift(style)
      const parent = style.attributes['style:parent-style-name']
      style = parent ? (this.pools.common.get(`${family}/${parent}`) ?? this.find(family, parent, inMaster)) : undefined
    }
    return found
  }

  /**
   * The properties of a kind (`graphic`, `paragraph`, `text`…) a style gives, over its family's default when asked, and
   * over the styles it comes from unless told not to: a text's drawings take no style but their own.
   */
  properties(family: string, name: string | undefined, kind: string, inMaster: boolean, withDefault = true, withParents = true): Properties {
    const key = `${family}/${name}/${kind}/${inMaster}/${withDefault}/${withParents}`
    const known = this.cache.get(key)
    if (known) return known
    const element = `style:${kind}-properties`
    const fallback = withDefault ? this.defaults.get(family === 'presentation' ? 'graphic' : family) : undefined
    const styles = withParents ? this.chain(family, name, inMaster) : [this.find(family, name, inMaster)]
    const layers = [fallback, ...styles].map((style) => childAt(style, element)?.attributes ?? {})
    const result = merged(layers)
    this.cache.set(key, result)
    return result
  }

  /** The list style a presentation style keeps in its graphic properties, its own or one it comes from. */
  ownList(family: string, name: string | undefined, inMaster: boolean): XmlNode | undefined {
    for (const style of this.chain(family, name, inMaster).reverse()) {
      const list = childAt(style, 'style:graphic-properties', 'text:list-style')
      if (list) return list
    }
    return undefined
  }
}

/** The families of fonts a file's faces name, by the faces' names, from the parts that declare them. */
export function fontFaces(roots: readonly (XmlNode | undefined)[]): Map<string, string> {
  const fonts = new Map<string, string>()
  for (const root of roots)
    for (const face of childrenNamed(childAt(root, 'office:font-face-decls'), 'style:font-face')) {
      const name = face.attributes['style:name']
      if (name) fonts.set(name, (face.attributes['svg:font-family'] ?? name).replace(/^['"]|['"]$/g, ''))
    }
  return fonts
}
