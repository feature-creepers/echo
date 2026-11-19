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
