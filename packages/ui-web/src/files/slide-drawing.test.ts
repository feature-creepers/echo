import { describe, expect, it } from 'vitest'
import type { Archive } from './archive.ts'
import { drawSlide } from './slide-drawing.ts'

const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** An archive of parts given as text, or as bytes. */
const archiveOf = (parts: Record<string, string | Uint8Array>): Archive =>
  new Map(Object.entries(parts).map(([name, value]) => [name, async () => (typeof value === 'string' ? new TextEncoder().encode(value) : value)]))

const relationshipsOf = (...targets: [string, string][]) =>
  `<Relationships>${targets.map(([id, target]) => `<Relationship Id="${id}" Target="${target}"/>`).join('')}</Relationships>`

const THEME = `<a:theme ${NAMESPACES}><a:themeElements><a:clrScheme name="Test">
  <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
  <a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>
  <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
</a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Test"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`

/** A box of a shape: where it is and how large, in pixels written as English Metric Units. */
const transform = (x: number, y: number, width: number, height: number, extra = '') =>
  `<a:xfrm${extra}><a:off x="${x * 9525}" y="${y * 9525}"/><a:ext cx="${width * 9525}" cy="${height * 9525}"/></a:xfrm>`

/** A placeholder of a kind, with what it holds. */
const placeholder = (type: string, inside: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${type}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr>${inside}</p:sp>`

const MASTER = `<p:sldMaster ${NAMESPACES}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef></p:bg><p:spTree>
  ${placeholder('title', `<p:spPr>${transform(40, 20, 880, 80)}</p:spPr><p:txBody><a:bodyPr anchor="b"/><a:p><a:r><a:t>Master title</a:t></a:r></a:p></p:txBody>`)}
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="Band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(0, 520, 960, 20)}<a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"/>
<p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`

const LAYOUT = `<p:sldLayout ${NAMESPACES}><p:cSld><p:spTree>${placeholder('title', '<p:spPr/>')}</p:spTree></p:cSld></p:sldLayout>`

/** A deck of one slide, its layout, master and theme, drawn at 960 by 540 pixels. */
async function drawn(slideShapes: string, extra: Record<string, string | Uint8Array> = {}) {
  const archive = archiveOf({
    'ppt/slides/slide1.xml': `<p:sld ${NAMESPACES}><p:cSld><p:spTree>${slideShapes}</p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': relationshipsOf(['rId1', '../slideLayouts/slideLayout1.xml'], ['rId2', '../media/image1.png']),
    'ppt/slideLayouts/slideLayout1.xml': LAYOUT,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relationshipsOf(['rId1', '../slideMasters/slideMaster1.xml']),
    'ppt/slideMasters/slideMaster1.xml': MASTER,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationshipsOf(['rId1', '../theme/theme1.xml']),
    'ppt/theme/theme1.xml': THEME,
    ...extra
  })
  const slide = await drawSlide(archive, 'ppt/slides/slide1.xml', { width: 960 * 9525, height: 540 * 9525 })
  return slide && { ...slide, text: new TextDecoder().decode(slide.svg) }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('a slide drawn', () => {
  it('draws its background and its master’s own shapes, at the size of the presentation’s slides', async () => {
    const slide = await drawn('')
    expect(slide && [slide.width, slide.height]).toEqual([960, 540])
    expect(slide?.text).toContain('<rect width="960" height="540" fill="#f3f4f6"/>')
    expect(slide?.text).toContain('<g transform="translate(0 520)"><path d="M0 0L960 0L960 20L0 20Z" fill="#ed7d31" stroke="none"/></g>')
    expect(slide?.text).not.toContain('Master title')
  })

  it('places a title where its master puts it, in the master’s font, size, colour and alignment', async () => {
    const text = (
      await drawn(placeholder('title', '<p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="fr-FR"/><a:t>Bilan &amp; suite</a:t></a:r></a:p></p:txBody>'))
    )?.text
    expect(text).toContain('<g transform="translate(40 20)"><foreignObject x="0" y="0" width="880" height="80" overflow="visible">')
    expect(text).toContain('justify-content:flex-end')
    expect(text).toContain('text-align:center;font-size:58.67px')
    expect(text).toContain("font-family:'Georgia', serif")
    expect(text).toContain(`<span style="font-size:58.67px;color:#1f2937;font-family:'Georgia', serif">Bilan &amp; suite</span>`)
  })

  it('draws a shape of its geometry, fill and line, turned, with its text over a bullet and in its style’s colour', async () => {
    const shape = `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>${transform(100, 100, 200, 100, ' rot="5400000"')}<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill><a:ln w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr>
      <p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
      <p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr marL="228600" indent="-228600"><a:buChar char="§"/></a:pPr><a:r><a:rPr b="1"/><a:t>Point</a:t></a:r></a:p></p:txBody></p:sp>`
    const text = (await drawn(shape))?.text
    expect(text).toContain(
      '<g transform="translate(100 100) rotate(90 100 50)"><path d="M10 0H190A10 10 0 0 1 200 10V90A10 10 0 0 1 190 100H10A10 10 0 0 1 0 90V10A10 10 0 0 1 10 0Z"'
    )
    expect(text).toContain('fill="#203864" stroke="#ff0000" stroke-width="4" stroke-dasharray="16 12"')
    expect(text).toContain('justify-content:center')
    expect(text).toContain('min-width:24px;color:#ffffff">▪</span><span style="font-size:24px;font-weight:bold;color:#ffffff">Point</span>')
  })

  it('draws a picture cropped, a group’s shapes in its own units, and a table', async () => {
    const picture = `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000" r="10000"/></p:blipFill><p:spPr>${transform(0, 0, 80, 60)}</p:spPr></p:pic>`
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${500 * 9525}" y="0"/><a:ext cx="${100 * 9525}" cy="${100 * 9525}"/><a:chOff x="0" y="0"/><a:chExt cx="${200 * 9525}" cy="${200 * 9525}"/></a:xfrm></p:grpSpPr>
      <p:sp><p:nvSpPr><p:cNvPr id="7" name="Dot"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(0, 0, 200, 200)}<a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr></p:sp></p:grpSp>`
    const cell = (text: string) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="${300 * 9525}"/><a:ext cx="${200 * 9525}" cy="${80 * 9525}"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="${100 * 9525}"/><a:gridCol w="${100 * 9525}"/></a:tblGrid>
      <a:tr h="${40 * 9525}">${cell('City')}${cell('Sales')}</a:tr><a:tr h="${40 * 9525}">${cell('Lyon')}${cell('120')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    const text = (await drawn(picture + group + table, { 'ppt/media/image1.png': PNG }))?.text
    expect(text).toContain(
      '<svg width="80" height="60" viewBox="10 0 80 100" preserveAspectRatio="none"><image width="100" height="100" preserveAspectRatio="none" href="data:image/png;base64,'
    )
    expect(text).toContain('<g transform="translate(500 0) scale(0.5 0.5) translate(0 0)"><g transform="translate(0 0)"><path d="M0 100A100 100 0 1 1 200 100')
    expect(text).toContain('<col style="width:100px"/><col style="width:100px"/>')
    expect(text).toContain('background:#4472c4;font-weight:bold;')
    expect(text).toContain('color:#ffffff">City</span>')
    expect(text).toContain('>Lyon</span>')
  })

  it('draws nothing for a slide whose master cannot be found, and leaves out a shape it cannot read', async () => {
    const archive = archiveOf({ 'ppt/slides/slide1.xml': `<p:sld ${NAMESPACES}><p:cSld><p:spTree/></p:cSld></p:sld>` })
    expect(await drawSlide(archive, 'ppt/slides/slide1.xml', { width: 9525, height: 9525 })).toBeUndefined()
    const text = (await drawn('<p:sp><p:nvSpPr><p:cNvPr id="9" name="Lost"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>'))?.text
    expect(text).not.toContain('Lost')
  })
})
