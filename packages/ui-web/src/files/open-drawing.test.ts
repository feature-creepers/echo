import { describe, expect, it } from 'vitest'
import type { Archive } from './archive.ts'
import { drawingSource, drawLoneShape, flattened, shapeColours, subpathEnds, subpaths, writePath } from './open-drawing.ts'
import { fontFaces, StyleBook } from './open-styles.ts'
import { childAt, xmlTree } from './xml.ts'

const NAMESPACES = 'xmlns:office="o" xmlns:style="s" xmlns:text="t" xmlns:draw="d" xmlns:svg="v" xmlns:fo="f"'

const STYLES = `<office:document-styles ${NAMESPACES}><office:styles>
<style:default-style style:family="graphic"><style:graphic-properties svg:stroke-color="#3465a4"/><style:text-properties fo:font-size="12pt"/></style:default-style>
<draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0L0 30H20Z"/>
<draw:stroke-dash draw:name="Dashed" draw:dots1="1" draw:dots1-length="300%" draw:distance="100%"/>
</office:styles></office:document-styles>`

const AUTOMATIC = `<office:automatic-styles>
<style:style style:name="arrow" style:family="graphic"><style:graphic-properties svg:stroke-color="#ff0000" svg:stroke-width="0.04in" draw:marker-end="Arrow" draw:marker-end-width="0.2in"/></style:style>
<style:style style:name="green" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#00ff00" draw:stroke="none"/></style:style>
<style:style style:name="dashed" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="dash" draw:stroke-dash="Dashed" svg:stroke-width="0.02in"/></style:style>
<style:style style:name="unwrapped" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none" fo:wrap-option="no-wrap" draw:textarea-vertical-align="middle"/><style:paragraph-properties fo:text-align="center"/></style:style>
</office:automatic-styles>`

/** A text's drawing as `drawLoneShape` draws it, from its element written as a text writes it. */
async function lone(element: string) {
  const content = xmlTree(
    `<office:document-content ${NAMESPACES}>${AUTOMATIC}<office:body><office:text>${element}</office:text></office:body></office:document-content>`
  )
  const styles = xmlTree(STYLES)
  const document = childAt(content, 'office:document-content')
  const stylesRoot = childAt(styles, 'office:document-styles')
  const book = new StyleBook(childAt(document, 'office:automatic-styles'), undefined, childAt(stylesRoot, 'office:styles'))
  const archive: Archive = new Map()
  const source = await drawingSource(archive, book, fontFaces([stylesRoot, document]), stylesRoot)
  const node = childAt(document, 'office:body', 'office:text')?.children.find((child) => child.name.startsWith('draw:'))
  if (!node) throw new Error('No drawing was written.')
  const drawn = await drawLoneShape(source, node, false, 1)
  return drawn && { ...drawn, text: new TextDecoder().decode(drawn.svg) }
}

const box = (x: number, y: number, width: number, height: number) => ({
  x: expect.closeTo(x, 1),
  y: expect.closeTo(y, 1),
  width: expect.closeTo(width, 1),
  height: expect.closeTo(height, 1)
})

describe('a text’s drawing drawn as a picture of its own', () => {
  it.each([
    {
      name: 'a line with an arrow at its end, in its colour, the arrow reaching past its box',
      element: '<draw:line draw:style-name="arrow" svg:x1="1in" svg:y1="1in" svg:x2="3in" svg:y2="2in"/>',
      box: box(96, 96, 192, 96),
      reach: 10.6,
      shows: ['stroke="#ff0000"', 'd="M10 0L0 30H20Z"', 'fill="#ff0000"']
    },
    {
      name: 'a rectangle at its place, filled as its style says',
      element: '<draw:rect draw:style-name="green" svg:x="0.5in" svg:y="0.25in" svg:width="2in" svg:height="1in"/>',
      box: box(48, 24, 192, 96),
      reach: 1,
      shows: ['fill="#00ff00"', 'translate(48 24)']
    },
    {
      name: 'a rectangle turned a quarter counter-clockwise by its transform',
      element: '<draw:rect draw:style-name="green" svg:width="1in" svg:height="0.5in" draw:transform="rotate (1.5707963267949) translate (1in 1in)"/>',
      box: box(96, 0, 48, 96),
      reach: 1,
      shows: ['rotate(-90)']
    },
    {
      name: 'a shape whose styles name no fill, in the blue LibreOffice gives it',
      element: '<draw:ellipse svg:width="1in" svg:height="1in"/>',
      box: box(0, 0, 96, 96),
      reach: 1.375,
      shows: ['fill="#729fcf"', 'stroke="#3465a4"']
    },
    {
      name: 'an arc, open and not filled',
      element: '<draw:ellipse draw:style-name="dashed" draw:kind="arc" draw:start-angle="0" draw:end-angle="180" svg:width="1in" svg:height="1in"/>',
      box: box(0, 0, 96, 96),
      reach: 1.96,
      shows: ['stroke-dasharray', 'fill="none"']
    },
    {
      name: 'a polygon from its points in its view box',
      element: '<draw:polygon draw:style-name="green" svg:width="1in" svg:height="1in" svg:viewBox="0 0 100 100" draw:points="0,0 100,0 50,100"/>',
      box: box(0, 0, 96, 96),
      reach: 1,
      shows: ['M0 0L96 0L48 96', 'fill="#00ff00"']
    },
    {
      name: 'a polyline, open',
      element: '<draw:polyline draw:style-name="arrow" svg:width="1in" svg:height="1in" svg:viewBox="0 0 100 100" draw:points="0,0 100,0 100,100"/>',
      box: box(0, 0, 96, 96),
      reach: 10.6,
      shows: ['d="M10 0L0 30H20Z"']
    },
    {
      name: 'a path of curves, scaled from its view box',
      element: '<draw:path draw:style-name="dashed" svg:width="2in" svg:height="1in" svg:viewBox="0 0 200 100" svg:d="M0 0C50 100 150 100 200 0"/>',
      box: box(0, 0, 192, 96),
      reach: 1.96,
      shows: ['M0 0C50 100 150 100 200 0', 'scale(0.96 0.96)']
    },
    {
      name: 'a custom shape of its own geometry, with its text in it',
      element:
        '<draw:custom-shape draw:style-name="green" svg:width="1in" svg:height="1in"><text:p>Hello</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ellipse" draw:enhanced-path="U 10800 10800 10800 10800 0 360 Z N"/></draw:custom-shape>',
      box: box(0, 0, 96, 96),
      reach: 1,
      shows: ['fill="#00ff00"', '>Hello<', '<foreignObject']
    },
    {
      name: 'a connector along the path it takes, in hundredths of a millimetre',
      element: '<draw:connector svg:x1="0cm" svg:y1="0cm" svg:x2="2cm" svg:y2="1cm" svg:d="M0 0L2000 0 2000 1000"/>',
      box: box(0, 0, 75.59, 37.8),
      reach: 1.375,
      shows: ['M0 0L75.59 0L75.59 37.8']
    },
    {
      name: 'a group around its shapes',
      element:
        '<draw:g><draw:rect draw:style-name="green" svg:width="1in" svg:height="1in"/><draw:rect draw:style-name="green" svg:x="2in" svg:y="1in" svg:width="1in" svg:height="1in"/></draw:g>',
      box: box(0, 0, 288, 192),
      reach: 1,
      shows: ['translate(192 96)']
    }
  ])('draws $name', async ({ element, box: expected, reach, shows }) => {
    const drawn = await lone(element)
    expect(drawn?.box).toEqual(expected)
    for (const side of ['top', 'right', 'bottom', 'left'] as const) expect(drawn?.reach[side]).toBeCloseTo(reach, 1)
    for (const piece of shows) expect(drawn?.text).toContain(piece)
    expect(drawn?.text).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(drawn?.text).not.toMatch(/<script|href="(?!data:)/)
  })

  it.each([
    { name: 'an empty group', element: '<draw:g/>' },
    { name: 'a shape of no size', element: '<draw:rect draw:style-name="green"/>' },
    { name: 'a shape of an absurd size', element: '<draw:rect svg:width="100000in" svg:height="1in"/>' },
    { name: 'an element that is no shape', element: '<draw:control svg:width="1in" svg:height="1in"/>' }
  ])('draws nothing for $name', async ({ element }) => {
    expect(await lone(element)).toBeUndefined()
  })

  it.each([
    { name: 'across, on both sides, when they do not wrap', style: 'unwrapped', across: true },
    { name: 'down, above and below, when they wrap', style: 'green', across: false }
  ])('lets a text’s words reach past a small shape $name', async ({ style, across }) => {
    const drawn = await lone(
      `<draw:custom-shape draw:style-name="${style}" svg:width="0.5in" svg:height="0.25in"><text:p>A label much wider than its shape</text:p><draw:enhanced-geometry draw:type="rectangle"/></draw:custom-shape>`
    )
    expect(drawn?.text).toContain('A label much wider than its shape')
    const [wide, narrow] = across ? (['left', 'top'] as const) : (['top', 'left'] as const)
    const [wideOther] = across ? (['right'] as const) : (['bottom'] as const)
    expect(drawn?.reach[wide]).toBeGreaterThan(20)
    expect(drawn?.reach[wide]).toBeCloseTo(drawn?.reach[wideOther] ?? 0, 3)
    expect(drawn?.reach[narrow]).toBeLessThan(20)
  })
})

describe('a text’s drawing reaching past its box', () => {
  it('lets a callout’s tail reach past its box, which alone takes room', async () => {
    const drawn = await lone(
      '<draw:custom-shape draw:style-name="green" svg:width="1in" svg:height="1in"><draw:enhanced-geometry svg:viewBox="0 0 100 100" draw:enhanced-path="M 0 0 L 100 0 100 100 60 100 50 300 40 100 0 100 Z N"/></draw:custom-shape>'
    )
    expect(drawn?.box).toEqual(box(0, 0, 96, 96))
    expect(drawn?.reach.bottom).toBeCloseTo(193, 0)
    expect(drawn?.reach.top).toBeCloseTo(1, 1)
  })

  it('bounds a curve by the points it passes through, not the controls it bends toward', async () => {
    const drawn = await lone(
      '<draw:path draw:style-name="green" svg:width="1in" svg:height="1in" svg:viewBox="0 0 100 100" svg:d="M0 0C0 133 100 133 100 0Z"/>'
    )
    expect(drawn?.reach.bottom).toBeCloseTo(1, 0)
  })
})

describe('a Fontwork drawn as LibreOffice draws it', () => {
  const fontwork = (path: string) =>
    `<draw:custom-shape draw:style-name="green" svg:width="2in" svg:height="1in"><text:p>Wave</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:text-path="true" draw:text-path-mode="shape" draw:text-path-scale="path" draw:type="fontwork-wave" draw:enhanced-path="${path}"/></draw:custom-shape>`

  it('draws its letters in its fill, between its two paths, and none of its geometry or its text’s frame', async () => {
    const drawn = await lone(fontwork('M 0 0 C 7200 6000 14400 -6000 21600 0 N M 0 21600 C 7200 27600 14400 15600 21600 21600 N'))
    expect(drawn?.text.match(/<text /g)).toHaveLength(4)
    expect(drawn?.text).toContain('fill="#00ff00"')
    expect(drawn?.text).not.toContain('<foreignObject')
    expect(drawn?.text).not.toMatch(/<path d="M0 0C/)
  })

  it('lets its letters on one path reach above and below it, past its box', async () => {
    const drawn = await lone(fontwork('M 0 0 L 21600 0 N'))
    expect(drawn?.text.match(/<text /g)).toHaveLength(4)
    expect(drawn?.reach.top).toBeGreaterThan(10)
  })

  it('draws nothing of a Fontwork with no text', async () => {
    const drawn = await lone(
      '<draw:custom-shape draw:style-name="green" svg:width="2in" svg:height="1in"><draw:enhanced-geometry draw:text-path="true" draw:enhanced-path="M 0 0 L 21600 0 N"/></draw:custom-shape>'
    )
    expect(drawn?.text ?? '').not.toContain('<text')
  })
})

describe('an extruded shape drawn as LibreOffice draws it', () => {
  it('draws its solid, reaching up and to the right past its box, under its text, with no outline', async () => {
    const drawn = await lone(
      '<draw:custom-shape draw:style-name="green" svg:width="1in" svg:height="1in"><text:p>Deep</text:p><draw:enhanced-geometry draw:extrusion="true" draw:extrusion-depth="1in 0" draw:enhanced-path="M 0 0 L 21600 0 21600 21600 0 21600 Z N"/></draw:custom-shape>'
    )
    expect(drawn?.box).toEqual(box(0, 0, 96, 96))
    expect(drawn?.reach.right).toBeGreaterThan(30)
    expect(drawn?.reach.top).toBeGreaterThan(30)
    expect(drawn?.reach.bottom).toBeLessThan(5)
    expect(drawn?.text.match(/<path /g)).toHaveLength(3)
    expect(drawn?.text.indexOf('<path ')).toBeLessThan(drawn?.text.indexOf('>Deep<') ?? 0)
    expect(drawn?.text).not.toContain('fill="#00ff00"')
  })

  it('draws an extruded Fontwork as its letters again along its depth', async () => {
    const drawn = await lone(
      '<draw:custom-shape draw:style-name="green" svg:width="2in" svg:height="1in"><text:p>3D</text:p><draw:enhanced-geometry draw:extrusion="true" draw:text-path="true" draw:enhanced-path="M 0 0 L 21600 0 N M 0 21600 L 21600 21600 N"/></draw:custom-shape>'
    )
    expect((drawn?.text.match(/<text /g) ?? []).length).toBeGreaterThan(20)
  })
})

describe('a path flattened into lines', () => {
  it.each([
    { data: 'M0 0L10 0L10 10', count: 3, last: [10, 10] },
    { data: 'M0 0L10 0L10 10Z', count: 4, last: [0, 0] },
    { data: 'M0 0C0 40 40 40 40 0', count: 31, last: [40, 0] },
    { data: 'M0 0A10 10 0 0 1 20 0', count: 37, last: [20, 0] },
    { data: 'nonsense', count: 0, last: undefined }
  ])('flattens $data', ({ data, count, last }) => {
    const lines = flattened(data)
    const points = lines.flat()
    expect(points).toHaveLength(count)
    expect(points.at(-1)?.map((value) => Math.round(value * 1000) / 1000)).toEqual(last)
  })
})

describe('the colours of a shape whose styles name none', () => {
  it.each([
    { generator: undefined, colours: { fill: '#729fcf', line: '#3465a4' } },
    { generator: 'LibreOffice/24.2.1.2$Windows_X86_64 LibreOffice_project/abc', colours: { fill: '#729fcf', line: '#3465a4' } },
    { generator: 'LibreOffice/4.1.3.2$Linux_X86_64 LibreOffice_project/abc', colours: { fill: '#99ccff', line: '#000000' } },
    { generator: 'LibreOfficeDev/4.4.0.0.alpha1$Windows_x86 LibreOffice_project/abc', colours: { fill: '#729fcf', line: '#3465a4' } },
    { generator: 'OpenOffice.org/3.3$Win32 OpenOffice.org_project/330m20$Build-9567', colours: { fill: '#99ccff', line: '#000000' } },
    { generator: 'StarOffice/8$Win32 OpenOffice.org_project/680m5$Build-9073', colours: { fill: '#99ccff', line: '#000000' } },
    { generator: 'OpenOffice/4.1.5$Win32 OpenOffice.org_project/415m1$Build-9789', colours: { fill: '#cfe7f5', line: '#808080' } },
    { generator: 'MicrosoftOffice/16.0 MicrosoftWord', colours: { fill: '#729fcf', line: '#3465a4' } }
  ])('are LibreOffice’s for a file written by $generator', ({ generator, colours }) => {
    expect(shapeColours(generator)).toEqual(colours)
  })
})

describe('a path read and written back', () => {
  it.each([
    { data: 'M0 0L10 0', written: 'M0 0L10 0', start: { at: [0, 0], outward: [-1, 0] }, end: { at: [10, 0], outward: [1, 0] } },
    { data: 'm5 5 h10 v10', written: 'M5 5L15 5L15 15', start: { at: [5, 5], outward: [-1, 0] }, end: { at: [15, 15], outward: [0, 1] } },
    { data: 'M0 0C0 10 10 10 10 0', written: 'M0 0C0 10 10 10 10 0', start: { at: [0, 0], outward: [0, -1] }, end: { at: [10, 0], outward: [0, -1] } },
    {
      data: 'M0 0Q5 5 10 0T20 0',
      written: 'M0 0Q5 5 10 0Q15 -5 20 0',
      start: { at: [0, 0], outward: [-Math.SQRT1_2, -Math.SQRT1_2] },
      end: { at: [20, 0], outward: [Math.SQRT1_2, Math.SQRT1_2] }
    },
    { data: 'M0 0A10 10 0 0 1 20 0', written: 'M0 0A10 10 0 0 1 20 0', start: { at: [0, 0], outward: [0, 1] }, end: { at: [20, 0], outward: [0, 1] } },
    { data: 'M0 0L10 0L10 10Z', written: 'M0 0L10 0L10 10Z', start: undefined, end: undefined },
    { data: 'M0 0L10', written: 'M0 0', start: undefined, end: undefined },
    { data: 'L5 5 Mnonsense', written: '', start: undefined, end: undefined }
  ])('reads $data', ({ data, written, start, end }) => {
    const paths = subpaths(data)
    expect(writePath(paths)).toBe(written)
    const open = paths.find((path) => !path.closed && path.segments.length > 0)
    const ends = open ? subpathEnds(open) : { start: undefined, end: undefined }
    const near = (found: { at: number[]; outward: number[] } | undefined) =>
      found && { at: found.at.map((value) => Math.round(value * 1000) / 1000), outward: found.outward.map((value) => Math.round(value * 1000) / 1000) }
    expect(near(ends.start)).toEqual(near(start))
    expect(near(ends.end)).toEqual(near(end))
  })
})
