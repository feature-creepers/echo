/** XML read as the Office formats write it: a step at a time, with no library and no validation. */

/** A step through an XML part: an element opened, with its attributes, closed, or text between. */
export type XmlEvent = { type: 'open'; name: string; attributes: Record<string, string> } | { type: 'close'; name: string } | { type: 'text'; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Text with its entities read: `&amp;`, `&#233;`, `&#xE9;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity] ?? whole
  })
}

/** An element of XML read whole: its name, its attributes, and the elements and text in it, text as `#text`. */
export interface XmlNode {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

/** An XML part as a tree of its elements, under a root of no name. Past a depth, elements are left out. */
export function xmlTree(xml: string, depthLimit = 96): XmlNode {
  const root: XmlNode = { name: '', attributes: {}, children: [], text: '' }
  const open: XmlNode[] = [root]
  let skipped = 0
  for (const event of xmlEvents(xml)) {
    const parent = open.at(-1) as XmlNode
    if (event.type === 'open') {
      if (skipped > 0 || open.length > depthLimit) {
        skipped++
        continue
      }
      const node: XmlNode = { name: event.name, attributes: event.attributes, children: [], text: '' }
      parent.children.push(node)
      open.push(node)
    } else if (event.type === 'close') {
      if (skipped > 0) skipped--
      else if (open.length > 1) open.pop()
    } else if (skipped === 0) parent.children.push({ name: '#text', attributes: {}, children: [], text: event.text })
  }
  return root
}

/** The first element of a name directly inside another, following names one inside the other. */
export function childAt(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let found = node
  for (const name of names) found = found?.children.find((child) => child.name === name)
  return found
}

/** The elements of a name directly inside another. */
export const childrenNamed = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter((child) => child.name === name) ?? []

/** The text of an element and those in it. */
export const textIn = (node: XmlNode): string => (node.name === '#text' ? node.text : node.children.map(textIn).join(''))

/**
 * The steps through an XML part, as the Office formats write them: elements, attributes and text. A self-closed
 * element is opened and closed; declarations, comments and instructions are passed over.
 */
export function* xmlEvents(xml: string): Generator<XmlEvent> {
  let at = 0
  while (at < xml.length) {
    const open = xml.indexOf('<', at)
    if (open < 0) {
      if (at < xml.length) yield { type: 'text', text: decodeEntities(xml.slice(at)) }
      return
    }
    if (open > at) yield { type: 'text', text: decodeEntities(xml.slice(at, open)) }
    if (xml.startsWith('<!--', open)) {
      const close = xml.indexOf('-->', open)
      at = close < 0 ? xml.length : close + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open)
      yield { type: 'text', text: xml.slice(open + 9, close < 0 ? xml.length : close) }
      at = close < 0 ? xml.length : close + 3
      continue
    }
    const close = xml.indexOf('>', open)
    if (close < 0) return
    const tag = xml.slice(open + 1, close)
    at = close + 1
    if (tag.startsWith('?') || tag.startsWith('!')) continue
    if (tag.startsWith('/')) {
      yield { type: 'close', name: tag.slice(1).trim() }
      continue
    }
    const selfClosed = tag.endsWith('/')
    const body = selfClosed ? tag.slice(0, -1) : tag
    const name = /^[^\s/>]+/.exec(body)?.[0] ?? ''
    const attributes: Record<string, string> = {}
    for (const match of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attributes[match[1] as string] = decodeEntities(match[3] ?? match[4] ?? '')
    }
    yield { type: 'open', name, attributes }
    if (selfClosed) yield { type: 'close', name }
  }
}
