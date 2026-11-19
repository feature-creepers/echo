import { describe, expect, it } from 'vitest'
import { artRecords } from './office-art.ts'
import { drawOlderSlide, olderDeck } from './older-slide-drawing.ts'

// Records of a presentation's stream, written as PowerPoint writes them.

const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
const u32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]

const record = (type: number, content: readonly number[], instance = 0, container = false) => [
  ...u16((instance << 4) | (container ? 0x0f : 0)),
  ...u16(type),
  ...u32(content.length),
  ...content
]
const holder = (type: number, children: readonly (readonly number[])[], instance = 0) => record(type, children.flat(), instance, true)

/** A table of properties: simple ones as numbers, complex ones as their bytes, after them all. */
const properties = (entries: [number, number | readonly number[]][]) => {
  const fixed = entries.flatMap(([id, value]) => (typeof value === 'number' ? [...u16(id), ...u32(value)] : [...u16(id | 0x8000), ...u32(value.length)]))
  const complex = entries.flatMap(([, value]) => (typeof value === 'number' ? [] : [...value]))
  return record(0xf00b, [...fixed, ...complex], entries.length)
}

/** An anchor on a slide in pixels, written in master units: top, left, right, bottom. */
const anchor = (x: number, y: number, width: number, height: number) =>
  record(0xf010, [...u16(y * 6), ...u16(x * 6), ...u16((x + width) * 6), ...u16((y + height) * 6)])

const shape = (kind: number, id: number, flags: number, parts: readonly (readonly number[])[]) =>
  holder(0xf004, [record(0xf00a, [...u32(id), ...u32(flags | 0x0a00)], kind), ...parts])

const placeholderData = (place: number) => holder(0xf011, [record(0x0bc3, [...u32(0), place, 0, 0, 0])])

const text = (kind: number, written: string, style: readonly number[] = [], extra: readonly (readonly number[])[] = []) =>
  holder(0xf00d, [
    record(0x0f9f, u32(kind)),
    record(
      0x0fa8,
      [...written].map((character) => character.charCodeAt(0))
    ),
    ...(style.length > 0 ? [record(0x0fa1, style)] : []),
    ...extra
  ])

const scheme = (colours: number[]) =>
  record(
    0x07f0,
    colours.flatMap((colour) => [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff, 0]),
    1
  )

const drawing = (shapes: readonly (readonly number[])[], background?: readonly number[]) =>
  holder(0x040c, [holder(0xf002, [holder(0xf003, [shape(0, 1, 0x05, []), ...shapes]), ...(background ? [background] : [])])])

/** A master style of text of a kind: its levels, each its paragraphs' masks and fields, then its runs'. */
const style = (kind: number, levels: readonly (readonly number[])[]) => record(0x0fa3, [...u16(levels.length), ...levels.flat()], kind)

const RED = 0xfe0000ff
const SCHEME = [0xffffff, 0x000000, 0x808080, 0x1f2937, 0x4472c4, 0xed7d31, 0x00ff00, 0x0000ff]

/**
 * A presentation of one master and one slide: the master has a background, a band, a title placeholder, and styles for
 * titles (44 points, the scheme's title colour) and bodies (a bullet, 28 then 24 points, the second level indented).
 */
function presentation(slideShapes: readonly (readonly number[])[], slideFlags = 7, slideOwn: readonly (readonly number[])[] = []) {
  const master = holder(0x03f8, [
    record(0x03ef, [...u32(1), ...new Array(8).fill(0), ...u32(0), ...u32(0), ...u16(0), ...u16(0)]),
    scheme(SCHEME),
    style(0, [[...u32(0x0800), ...u16(1), ...u32(0x60000), ...u16(44), ...u32(0x03000000)]]),
    style(1, [
      [...u32(0x0981), ...u16(1), ...u16(0x2022), ...u16(0), ...u16(144), ...u32(0x20000), ...u16(28)],
      [...u32(0x0500), ...u16(432), ...u16(288), ...u32(0x20000), ...u16(24)]
    ]),
    drawing(
      [
        shape(1, 0x401, 0, [properties([[0x0181, 0x00ff0000]]), anchor(0, 520, 960, 20)]),
        shape(1, 0x402, 0, [properties([[0x01bf, 0x00100000]]), anchor(40, 20, 880, 80), placeholderData(1), text(0, 'Master title')])
      ],
      shape(1, 0x403, 0x400, [properties([[0x0181, 0x08000000]])])
    )
  ])
  const slide = holder(0x03ee, [
    record(0x03ef, [...u32(0), ...new Array(8).fill(0), ...u32(0x80000000), ...u32(0), ...u16(slideFlags), ...u16(0)]),
    drawing(slideShapes, slideOwn[0]),
    ...slideOwn.slice(1)
  ])
  const fonts = holder(0x07d5, [
    record(0x0fb7, [...[...'Verdana'].flatMap((character) => u16(character.charCodeAt(0))), ...new Array(50).fill(0), 0, 0, 0, 0], 0)
  ])
  const defaults = record(
    0xf00b,
    [...u16(0x0181), ...u32(0x08000004), ...u16(0x01bf), ...u32(0x00100010), ...u16(0x01c0), ...u32(0x08000001), ...u16(0x01ff), ...u32(0x00080008)],
    4
  )
  const lists = (masterAt: number, slideAt: number) => [
    holder(0x0ff0, [record(0x03f3, [...u32(1), ...u32(0), ...u32(0), ...u32(0x80000000), ...u32(0)])], 1),
    holder(0x0ff0, [record(0x03f3, [...u32(2), ...u32(0), ...u32(0), ...u32(256), ...u32(0)])], 0),
    [masterAt, slideAt]
  ]
  const documentOf = (masterAt: number, slideAt: number) => {
    const [masterList, slideList] = lists(masterAt, slideAt) as [number[], number[]]
    return holder(0x03e8, [
      record(0x03e9, [...u32(5760), ...u32(3240), ...new Array(32).fill(0)]),
      holder(0x03f2, [fonts]),
      holder(0x040b, [holder(0xf000, [defaults])]),
      masterList,
      slideList
    ])
  }
  const documentLength = documentOf(0, 0).length
  const bytes = new Uint8Array([...documentOf(documentLength, documentLength + master.length), ...master, ...slide])
  const places = new Map([
    [1, documentLength],
    [2, documentLength + master.length]
  ])
  const [document] = artRecords(bytes, 0)
  const [slideRecord] = artRecords(bytes, documentLength + master.length)
  if (!document || !slideRecord) throw new Error('The presentation was not written.')
  return { deck: olderDeck(bytes, places, document, () => undefined), slide: slideRecord }
}

async function drawn(slideShapes: readonly (readonly number[])[], slideFlags?: number, slideOwn?: readonly (readonly number[])[]) {
  const { deck, slide } = presentation(slideShapes, slideFlags, slideOwn)
  const result = await drawOlderSlide(deck, slide, 2, 3)
  return result && { ...result, written: new TextDecoder().decode(result.svg) }
}

describe('a slide of PowerPoint 97 to 2003 drawn', () => {
  it('draws its master’s background and own shapes, at the size of the presentation’s slides, but not its placeholders', async () => {
    const slide = await drawn([])
    expect(slide && [slide.width, slide.height]).toEqual([960, 540])
    expect(slide?.written).toContain('<rect width="960" height="540" fill="#ffffff"/>')
    expect(slide?.written).toContain('<g transform="translate(0 520)"><path d="M0 0L960 0L960 20L0 20Z" fill="#0000ff" stroke="#000000" stroke-width="1"/></g>')
    expect(slide?.written).not.toContain('Master title')
  })

  it('leaves out the master when the slide does not follow it, and draws its own background', async () => {
    const own = shape(1, 0x500, 0x400, [properties([[0x0181, 0x00303030]])])
    const svg = (await drawn([], 0, [own]))?.written
    expect(svg).toContain('<rect width="960" height="540" fill="#303030"/>')
    expect(svg).not.toContain('#0000ff')
  })

  it('writes a title in its master’s style, and runs in their own', async () => {
    const title = shape(1, 0x101, 0, [
      properties([
        [0x01bf, 0x00100000],
        [0x01ff, 0x00080000]
      ]),
      anchor(60, 30, 840, 90),
      placeholderData(13),
      text(0, 'Bilan & suite', [...u32(14), ...u16(0), ...u32(0), ...u32(6), ...u32(0x40001), ...u16(1), ...u32(RED), ...u32(8), ...u32(0)])
    ])
    const svg = (await drawn([title]))?.written
    expect(svg).toContain('<g transform="translate(60 30)"><foreignObject x="0" y="0" width="840" height="90" overflow="visible">')
    expect(svg).toContain('text-align:center;font-size:58.67px')
    expect(svg).toContain("font-family:'Verdana', sans-serif;color:#1f2937")
    expect(svg).toContain(
      '<span style="font-size:58.67px;font-weight:bold;color:#ff0000">Bilan </span><span style="font-size:58.67px;color:#1f2937">&amp; suite</span>'
    )
    expect(svg).not.toContain('<g transform="translate(60 30)"><path')
  })

  it('bullets a body’s paragraphs at their levels and writes the slide’s number in its field', async () => {
    const body = shape(1, 0x102, 0, [
      properties([
        [0x01bf, 0x00100000],
        [0x01ff, 0x00080000]
      ]),
      anchor(60, 140, 840, 300),
      placeholderData(14),
      text(1, 'First\rSecond, slide *', [...u32(6), ...u16(0), ...u32(0), ...u32(13), ...u16(1), ...u32(0), ...u32(19), ...u32(0)], [record(0x0fd8, u32(20))])
    ])
    const svg = (await drawn([body]))?.written
    expect(svg).toContain('padding-left:24px;text-indent:-24px')
    expect(svg).toContain('min-width:24px;">•</span><span style="font-size:37.33px')
    expect(svg).toContain('padding-left:72px;text-indent:-24px')
    expect(svg).toContain('Second, slide 3</span>')
  })

  it('draws a shape of its kind, colours and line, turned with its anchor turned back, and turned over', async () => {
    const box = shape(2, 0x103, 0x80, [
      properties([
        [0x0004, 90 * 65_536],
        [0x0147, 2160],
        [0x0181, 0x08000005],
        [0x0182, 0x8000],
        [0x01c0, 0x000000ff],
        [0x01cb, 38_100],
        [0x01ce, 6]
      ]),
      anchor(150, 50, 100, 200)
    ])
    const svg = (await drawn([box]))?.written
    expect(svg).toContain('<g transform="translate(100 100) rotate(90 100 50) translate(0 100) scale(1 -1)"><path d="M10 0H190A10 10 0 0 1 200 10V90')
    expect(svg).toContain('fill="#ed7d31" fill-opacity="0.5" stroke="#ff0000" stroke-width="4" stroke-dasharray="16 12"')
  })

  it('draws a gradient along its angle, the first colour where its focus puts it', async () => {
    const shaded = shape(1, 0x104, 0, [
      properties([
        [0x0180, 7],
        [0x0181, 0x000000ff],
        [0x0183, 0x00ff0000],
        [0x018b, 90 * 65_536],
        [0x018c, 100]
      ]),
      anchor(0, 0, 100, 100)
    ])
    const svg = (await drawn([shaded]))?.written
    expect(svg).toContain(
      '<linearGradient id="g1" x1="1" y1="0.5" x2="0" y2="0.5"><stop offset="0" stop-color="#0000ff"/><stop offset="1" stop-color="#ff0000"/>'
    )
  })

  it('draws a shape by its own vertices and segments, and a group’s shapes in its own units', async () => {
    const vertices = [...u16(3), ...u16(3), ...u16(8), ...[0, 0, 100, 0, 100, 100].flatMap((value) => u32(value))]
    const segments = [...u16(4), ...u16(4), ...u16(2), ...u16(0x4000), ...u16(0x0002), ...u16(0x6001), ...u16(0x8000)]
    const custom = shape(0, 0x105, 0x02, [
      properties([
        [0x0142, 100],
        [0x0143, 100],
        [0x0145, vertices],
        [0x0146, segments],
        [0x0181, 0x0000ff00]
      ]),
      record(0xf00f, [...u32(0), ...u32(0), ...u32(1000), ...u32(1000)])
    ])
    const group = holder(0xf003, [
      shape(0, 0x106, 0x01, [record(0xf009, [...u32(0), ...u32(0), ...u32(2000), ...u32(2000)]), anchor(500, 0, 100, 100)]),
      custom
    ])
    const svg = (await drawn([group]))?.written
    expect(svg).toContain('<g transform="translate(500 0)"><path d="M0 0L50 0L50 50Z" fill="#00ff00"')
  })

  it('draws nothing for a record that is no slide, and leaves out a shape it cannot read', async () => {
    const { deck, slide } = presentation([])
    expect(await drawOlderSlide(deck, { ...slide, type: 0x03f8 }, 2, 1)).toBeUndefined()
    const broken = holder(0xf004, [record(0xf00a, [1, 2], 1)])
    const svg = (await drawn([broken, shape(1, 0x107, 0, [properties([[0x0181, 0x0000ff00]]), anchor(1, 1, 10, 10)])]))?.written
    expect(svg).toContain('<g transform="translate(1 1)"><path d="M0 0L10 0L10 10L0 10Z" fill="#00ff00"')
  })
})
