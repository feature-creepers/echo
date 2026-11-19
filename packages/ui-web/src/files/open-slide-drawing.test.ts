import { describe, expect, it } from 'vitest'
import type { Archive } from './archive.ts'
import { naturalSize } from './open-drawing.ts'
import { drawOpenPage, openDeck } from './open-slide-drawing.ts'
import { childAt, childrenNamed, xmlTree } from './xml.ts'

const NAMESPACES =
  'xmlns:office="o" xmlns:style="s" xmlns:text="t" xmlns:draw="d" xmlns:svg="v" xmlns:fo="f" xmlns:presentation="p" xmlns:xlink="x" xmlns:table="b"'

const STYLES = `<office:document-styles ${NAMESPACES}>
<office:font-face-decls><style:font-face style:name="Serif" svg:font-family="'Liberation Serif'"/></office:font-face-decls>
<office:styles>
  <style:default-style style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#729fcf" draw:stroke="solid" svg:stroke-color="#3465a4"/><style:text-properties fo:font-size="18pt" style:font-name="Serif"/></style:default-style>
  <draw:gradient draw:name="Sky" draw:style="linear" draw:angle="900" draw:start-color="#ff0000" draw:end-color="#0000ff" draw:border="0%"/>
  <draw:stroke-dash draw:name="Dashed" draw:dots1="1" draw:dots1-length="300%" draw:distance="100%"/>
  <style:style style:name="Default-title" style:family="presentation"><style:graphic-properties draw:fill="none" draw:stroke="none" draw:textarea-vertical-align="middle"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="44pt" fo:color="#1f2937"/></style:style>
  <style:style style:name="Default-outline1" style:family="presentation"><style:graphic-properties draw:fill="none" draw:stroke="none"><text:list-style style:name="Default-outline1"><text:list-level-style-bullet text:level="1" text:bullet-char="●"><style:list-level-properties text:min-label-width="0.25in"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="2" text:bullet-char="–"><style:list-level-properties text:space-before="0.5in" text:min-label-width="0.25in"/></text:list-level-style-bullet></text:list-style></style:graphic-properties><style:text-properties fo:font-size="32pt"/></style:style>
  <style:style style:name="Default-outline2" style:family="presentation" style:parent-style-name="Default-outline1"><style:text-properties fo:font-size="75%"/></style:style>
  <style:style style:name="Band" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#ff0000" draw:stroke="none"/></style:style>
</office:styles>
<office:automatic-styles>
  <style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="10in" fo:page-height="7.5in"/></style:page-layout>
  <style:style style:name="Mdp" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#eeeeee"/></style:style>
  <style:style style:name="Mfooter" style:family="presentation"><style:graphic-properties draw:fill="none" draw:stroke="none"/></style:style>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp">
  <draw:frame presentation:class="title" presentation:style-name="Default-title" svg:x="0in" svg:y="0in" svg:width="10in" svg:height="1in"><draw:text-box><text:p>Master title</text:p></draw:text-box></draw:frame>
  <draw:rect draw:style-name="Band" svg:x="0in" svg:y="7in" svg:width="10in" svg:height="0.5in"/>
  <draw:frame presentation:class="footer" presentation:style-name="Mfooter" svg:x="1in" svg:y="7in" svg:width="8in" svg:height="0.5in"><draw:text-box><text:p><presentation:footer/></text:p></draw:text-box></draw:frame>
  <draw:frame presentation:class="page-number" presentation:style-name="Mfooter" svg:x="9in" svg:y="7in" svg:width="1in" svg:height="0.5in"><draw:text-box><text:p>Page <text:page-number>1</text:page-number></text:p></draw:text-box></draw:frame>
</style:master-page></office:master-styles></office:document-styles>`

const content = (page: string, pageStyle = '') => `<office:document-content ${NAMESPACES}><office:automatic-styles>
  <style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties presentation:display-footer="true" ${pageStyle}/></style:style>
  <style:style style:name="pr1" style:family="presentation" style:parent-style-name="Default-title"/>
  <style:style style:name="pr2" style:family="presentation" style:parent-style-name="Default-outline1"/>
  <style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="gradient" draw:fill-gradient-name="Sky" draw:stroke="dash" draw:stroke-dash="Dashed" svg:stroke-width="0.04in" svg:stroke-color="#000000"/></style:style>
  <style:style style:name="gr2" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none" fo:clip="rect(0in, 0in, 0in, 0.25in)"/></style:style>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#00ff00"/></style:style>
  <text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="i" style:num-suffix=")"><style:list-level-properties text:min-label-width="0.3in"/></text:list-level-style-number></text:list-style>
</office:automatic-styles><office:body><office:presentation>
  <presentation:footer-decl presentation:name="ftr1">Lyon, 2026</presentation:footer-decl>
  <draw:page draw:name="One" draw:style-name="dp1" draw:master-page-name="Default" presentation:use-footer-name="ftr1">${page}</draw:page>
</office:presentation></office:body></office:document-content>`

/** A PNG of 192 by 96 pixels at 192 to the inch: 96 by 48 pixels at the window's 96. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0xc0, 0, 0, 0, 0x60, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9,
  0x70, 0x48, 0x59, 0x73, 0, 0, 0x1d, 0x87, 0, 0, 0x1d, 0x87, 1, 0, 0, 0, 0
])

async function drawn(page: string, pageStyle?: string) {
  const xml = content(page, pageStyle)
  const archive: Archive = new Map(
    Object.entries({ 'styles.xml': STYLES, 'content.xml': xml, 'Pictures/dot.png': PNG }).map(([name, value]) => [
      name,
      async () => (typeof value === 'string' ? new TextEncoder().encode(value) : value)
    ])
  )
  const tree = xmlTree(xml)
  const deck = await openDeck(archive, tree)
  const [first] = childrenNamed(childAt(tree, 'office:document-content', 'office:body', 'office:presentation'), 'draw:page')
  const slide = first && (await drawOpenPage(deck, first, 4))
  return slide && { ...slide, written: new TextDecoder().decode(slide.svg) }
}

describe('a page of an OpenDocument presentation drawn', () => {
  it('draws its master’s background and own shapes at its layout’s size, and its footers as the page says, not its placeholders', async () => {
    const slide = await drawn('')
    expect(slide && [slide.width, slide.height]).toEqual([960, 720])
    expect(slide?.written).toContain('<rect width="960" height="720" fill="#eeeeee"/>')
    expect(slide?.written).toContain('<g transform="translate(0 672)"><path d="M0 0L960 0L960 48L0 48Z" fill="#ff0000" fill-rule="evenodd" stroke="none"/></g>')
    expect(slide?.written).toContain('>Lyon, 2026</span>')
    expect(slide?.written).not.toContain('Master title')
    expect(slide?.written).not.toContain('Page 4')
    expect((await drawn('', 'presentation:display-page-number="true" presentation:background-objects-visible="true"'))?.written).toContain('>Page 4</span>')
    expect((await drawn('', 'draw:fill="solid" draw:fill-color="#202030" presentation:background-objects-visible="false"'))?.written).not.toContain('#ff0000')
  })

  it('writes a title in its master’s style, and its runs in their own', async () => {
    const written = (
      await drawn(
        '<draw:frame presentation:style-name="pr1" presentation:class="title" svg:x="1in" svg:y="0.5in" svg:width="8in" svg:height="1in"><draw:text-box><text:p>Bilan <text:span text:style-name="T1">&amp; suite</text:span></text:p></draw:text-box></draw:frame>'
      )
    )?.written
    expect(written).toContain('<g transform="translate(96 48)"><foreignObject x="0" y="0" width="768" height="96" overflow="visible">')
    expect(written).toContain('justify-content:center')
    expect(written).toContain("font-family:'Liberation Serif', serif;color:#1f2937")
    expect(written).toContain('text-align:center;font-size:58.67px')
    expect(written).toContain(`<span style="font-size:58.67px;font-weight:bold;color:#00ff00;font-family:'Liberation Serif', serif">&amp; suite</span>`)
  })

  it('bullets an outline at its levels, in its master’s outline styles, and numbers a list as its style says', async () => {
    const outline = `<draw:frame presentation:style-name="pr2" presentation:class="outline" svg:x="0in" svg:y="1in" svg:width="10in" svg:height="5in"><draw:text-box>
      <text:list><text:list-item><text:p>First</text:p><text:list><text:list-item><text:p>Deeper</text:p></text:list-item></text:list></text:list-item></text:list>
      <text:list text:style-name="L1"><text:list-item><text:p>One</text:p></text:list-item><text:list-item><text:p>Two</text:p></text:list-item></text:list></draw:text-box></draw:frame>`
    const written = (await drawn(outline))?.written
    expect(written).toContain(
      'font-size:42.67px;line-height:1.2;padding-left:24px;text-indent:-24px"><span style="display:inline-block;text-indent:0;min-width:24px;">●</span>'
    )
    expect(written).toContain(
      'font-size:32px;line-height:1.2;padding-left:72px;text-indent:-24px"><span style="display:inline-block;text-indent:0;min-width:24px;">–</span>'
    )
    expect(written).toContain('min-width:28.8px;">i)</span>')
    expect(written).toContain('min-width:28.8px;">ii)</span>')
  })

  it('draws a custom shape turned by its transform, filled with its gradient and dashed, and an ellipse and a line', async () => {
    const shapes = `<draw:custom-shape draw:style-name="gr1" svg:width="2in" svg:height="1in" draw:transform="rotate (1.5707963267949) translate (1in 3in)">
        <draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:enhanced-path="M 0 0 L 21600 0 21600 21600 0 21600 Z N"/></draw:custom-shape>
      <draw:ellipse draw:style-name="Band" svg:x="5in" svg:y="5in" svg:width="1in" svg:height="1in"/>
      <draw:line draw:style-name="Band" svg:x1="0in" svg:y1="0in" svg:x2="1in" svg:y2="1in"/>`
    const written = (await drawn(shapes))?.written
    expect(written).toContain(
      '<g transform="translate(96 288) rotate(-90)"><path d="M0 0L192 0L192 96L0 96Z" fill="url(#g1)" fill-rule="evenodd" stroke="#000000" stroke-width="3.84" stroke-dasharray="11.52 3.84"/>'
    )
    expect(written).toContain(
      '<linearGradient id="g1" x1="0" y1="0.5" x2="1" y2="0.5"><stop offset="0" stop-color="#ff0000"/><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>'
    )
    expect(written).toContain(
      '<g transform="translate(480 480)"><path d="M96 48A48 48 0 0 0 0 48A48 48 0 0 0 96 48" fill="#ff0000" fill-rule="evenodd" stroke="none"/></g>'
    )
    expect(written).toContain('<path d="M0 0L96 96" fill="none" stroke="none"/>')
  })

  it('draws a frame’s picture cropped as its style says, and leaves out a placeholder left empty', async () => {
    const written = (
      await drawn(
        '<draw:frame draw:style-name="gr2" svg:x="0in" svg:y="0in" svg:width="1in" svg:height="1in"><draw:image xlink:href="Pictures/dot.png"/></draw:frame><draw:frame presentation:class="title" presentation:placeholder="true" presentation:style-name="pr1" svg:x="0in" svg:y="0in" svg:width="1in" svg:height="1in"><draw:text-box/></draw:frame>'
      )
    )?.written
    expect(written).toContain('<svg width="96" height="96" viewBox="25 0 75 100" preserveAspectRatio="none">')
    expect(written).not.toContain('<g transform="translate(0 0)"><foreignObject')
    expect(naturalSize(PNG)?.width).toBeCloseTo(96, 2)
    expect(naturalSize(PNG)?.height).toBeCloseTo(48, 2)
  })

  it('draws nothing for an element that is no page', async () => {
    const archive: Archive = new Map([['styles.xml', async () => new TextEncoder().encode(STYLES)]])
    const deck = await openDeck(archive, xmlTree(content('')))
    expect(await drawOpenPage(deck, { name: 'draw:frame', attributes: {}, children: [], text: '' }, 1)).toBeUndefined()
  })
})
