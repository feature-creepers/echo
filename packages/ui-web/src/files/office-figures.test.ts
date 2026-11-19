import { describe, expect, it } from 'vitest'
import { type CellValue, cellRange, emuPixels, lengthPixels, pictureType, readChart, readOpenChart } from './office-figures.ts'
import { type InlinePart, inlineLines, joinBlocks } from './office-text.ts'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

describe('a picture of an Office file', () => {
  it.each<[string, Uint8Array, string | undefined]>([
    ['PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['JPEG', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['GIF', text('GIF89a'), 'image/gif'],
    ['BMP', text('BM\x00\x00'), 'image/bmp'],
    ['WebP', text('RIFF\x00\x00\x00\x00WEBPVP8 '), 'image/webp'],
    ['SVG', text('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'],
    ['EMF, which the window does not show but is drawn', bytes(0x01, 0x00, 0x00, 0x00, 0x6c, 0x00, 0x00, 0x00), undefined],
    ['WMF', bytes(0xd7, 0xcd, 0xc6, 0x9a), undefined],
    ['TIFF', text('II*\x00'), undefined],
    ['RIFF that is not WebP', text('RIFF\x00\x00\x00\x00WAVE'), undefined],
    ['nothing', bytes(), undefined]
  ])('knows %s by its first bytes', (_, given, type) => {
    expect(pictureType(given)).toBe(type)
  })

  it.each<[string | undefined, number | undefined]>([
    ['914400', 96],
    ['4572000', 480],
    ['0', undefined],
    ['-5', undefined],
    ['wide', undefined],
    [undefined, undefined]
  ])('reads %j English Metric Units as %j pixels', (value, pixels) => {
    expect(emuPixels(value)).toBe(pixels)
  })

  it.each<[string | undefined, number | undefined]>([
    ['1in', 96],
    ['2.54cm', 96],
    ['25.4mm', 96],
    ['72pt', 96],
    ['120px', 120],
    ['5em', undefined],
    ['', undefined],
    [undefined, undefined]
  ])('reads the length %j as %j pixels', (value, pixels) => {
    expect(lengthPixels(value)).toBe(pixels)
  })
})

/** A DrawingML chart of the kind given, its title and its series, as Excel saves one with the values it drew. */
const chartSpace = (kind: string, title: string, series: string) =>
  '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart>' +
  (title === '' ? '' : `<c:title><c:tx><c:rich><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title>`) +
  `<c:plotArea><c:${kind}>${series}</c:${kind}><c:catAx/><c:valAx><c:title><c:tx><c:rich><a:p><a:r><a:t>Axis</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx></c:plotArea></c:chart></c:chartSpace>`

const cached = (kind: 'str' | 'num', ...values: (string | undefined)[]) =>
  `<c:${kind}Ref><c:f>Sheet1!$A$2:$A$4</c:f><c:${kind}Cache>${kind === 'num' ? '<c:formatCode>General</c:formatCode>' : ''}<c:ptCount val="${values.length}"/>` +
  values.map((value, index) => (value === undefined ? '' : `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`)).join('') +
  `</c:${kind}Cache></c:${kind}Ref>`

const series = (name: string, labels: string, values: string) =>
  `<c:ser><c:idx val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
  `<c:cat>${labels}</c:cat><c:val>${values}</c:val></c:ser>`

describe('a chart of Word, Excel or PowerPoint', () => {
  it('reads its title, its kind and the values each series kept, a missing one left out', async () => {
    const xml = chartSpace(
      'barChart',
      'Sales',
      series('2025', cached('str', 'Jan', 'Feb', 'Mar'), cached('num', '10', undefined, '7.5')) +
        series('2026', cached('str', 'Jan', 'Feb', 'Mar'), cached('num', '12', '9', '-3'))
    )
    expect(await readChart(xml)).toEqual({
      title: 'Sales',
      chart: 'bar',
      series: [
        {
          name: '2025',
          points: [
            { x: 'Jan', y: 10 },
            { x: 'Mar', y: 7.5 }
          ]
        },
        {
          name: '2026',
          points: [
            { x: 'Jan', y: 12 },
            { x: 'Feb', y: 9 },
            { x: 'Mar', y: -3 }
          ]
        }
      ]
    })
  })

  it.each<[string, 'line' | 'area' | 'bar']>([
    ['lineChart', 'line'],
    ['line3DChart', 'line'],
    ['scatterChart', 'line'],
    ['areaChart', 'area'],
    ['pieChart', 'bar'],
    ['doughnutChart', 'bar'],
    ['bar3DChart', 'bar']
  ])('draws a %s as a %s', async (kind, drawn) => {
    const chart = await readChart(chartSpace(kind, '', series('A', cached('str', 'x'), cached('num', '1'))))
    expect(chart?.chart).toBe(drawn)
  })

  it('labels points by their place when it kept no categories, and names a series with no name', async () => {
    const xml = chartSpace('lineChart', '', `<c:ser><c:val>${cached('num', '4', '5')}</c:val></c:ser>`)
    expect(await readChart(xml)).toEqual({
      title: '',
      chart: 'line',
      series: [
        {
          name: 'Series 1',
          points: [
            { x: '1', y: 4 },
            { x: '2', y: 5 }
          ]
        }
      ]
    })
  })

  it('labels a category of several levels by its first', async () => {
    const labels =
      '<c:multiLvlStrRef><c:multiLvlStrCache><c:ptCount val="2"/>' +
      '<c:lvl><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:lvl>' +
      '<c:lvl><c:pt idx="0"><c:v>2026</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef>'
    const chart = await readChart(chartSpace('barChart', '', series('A', labels, cached('num', '1', '2'))))
    expect(chart?.series[0]?.points.map((point) => point.x)).toEqual(['Q1', 'Q2'])
  })

  it('labels categories kept as numbers as their format shows them', async () => {
    const dates =
      '<c:numRef><c:numCache><c:formatCode>mmm yyyy</c:formatCode><c:pt idx="0"><c:v>45231</c:v></c:pt><c:pt idx="1"><c:v>45261</c:v></c:pt></c:numCache></c:numRef>'
    const chart = await readChart(chartSpace('lineChart', '', series('A', dates, cached('num', '1', '2'))), { locale: 'en-US' })
    expect(chart?.series[0]?.points.map((point) => point.x)).toEqual(['Nov 2023', 'Dec 2023'])
  })

  it('reads a series that kept no values from the cells its formulas name', async () => {
    const sheet = new Map<string, CellValue>([
      ['0,1', { text: 'Visitors' }],
      ['1,0', { text: 'May' }],
      ['1,1', { text: '1,200', number: 1200 }],
      ['2,0', { text: 'June' }],
      ['2,1', { text: '1,500', number: 1500 }]
    ])
    const cells = cellRange(new Map([['My sheet', sheet]]))
    const named = (formula: string) => `<c:strRef><c:f>${formula}</c:f></c:strRef>`
    const xml = chartSpace(
      'barChart',
      '',
      `<c:ser><c:tx>${named("'My sheet'!$B$1")}</c:tx><c:cat>${named("'my SHEET'!$A$2:$A$3")}</c:cat><c:val><c:numRef><c:f>'My sheet'!$B$2:$B$3</c:f></c:numRef></c:val></c:ser>`
    )
    expect(await readChart(xml, {}, async () => cells)).toEqual({
      title: '',
      chart: 'bar',
      series: [
        {
          name: 'Visitors',
          points: [
            { x: 'May', y: 1200 },
            { x: 'June', y: 1500 }
          ]
        }
      ]
    })
    expect(await readChart(xml)).toBeUndefined()
    expect(await readChart(xml, {}, async () => undefined)).toBeUndefined()
  })

  it('reads no cells for a chart whose series kept what they draw', async () => {
    let asked = 0
    const cells = async () => {
      asked++
      return cellRange(new Map())
    }
    const kept = chartSpace('barChart', 'Kept', series('A', cached('str', 'x'), cached('num', '1')))
    expect((await readChart(kept, {}, cells))?.series).toEqual([{ name: 'A', points: [{ x: 'x', y: 1 }] }])
    expect(asked).toBe(0)
  })

  it.each<[string, string[] | undefined]>([
    ['Data!$A$1', ['a']],
    ['Data!A1:B2', ['a', 'b', 'c', '']],
    ['(Data!$B$1:$A$1)', ['a', 'b']],
    ["'It''s'!$A$1", ['quoted']],
    ['Missing!$A$1', undefined],
    ['Data!$A:$A', undefined],
    ['Data!$A$1,Data!$B$1', undefined]
  ])('reads the cells %j names', (formula, texts) => {
    const cells = cellRange(
      new Map([
        [
          'Data',
          new Map<string, CellValue>([
            ['0,0', { text: 'a' }],
            ['0,1', { text: 'b' }],
            ['1,0', { text: 'c' }]
          ])
        ],
        ["It's", new Map<string, CellValue>([['0,0', { text: 'quoted' }]])]
      ])
    )
    expect(cells(formula)?.map((cell) => cell.text)).toEqual(texts)
  })

  it('has nothing to draw when no series kept a value', async () => {
    expect(await readChart(chartSpace('barChart', 'Empty', series('A', cached('str', 'x'), cached('num', undefined))))).toBeUndefined()
    expect(await readChart('<c:chartSpace><c:chart><c:plotArea/></c:chart></c:chartSpace>')).toBeUndefined()
  })
})

describe('a chart of OpenDocument', () => {
  it('reads its class, its title and the table of values it keeps', async () => {
    const cell = (value: string) => `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`
    const label = (value: string) => `<table:table-cell office:value-type="string"><text:p>${value}</text:p></table:table-cell>`
    const xml =
      '<office:document-content><office:body><office:chart><chart:chart chart:class="chart:line">' +
      '<chart:title><text:p>Visitors</text:p></chart:title><chart:plot-area><chart:series/></chart:plot-area>' +
      '<table:table table:name="local-table"><table:table-header-rows><table:table-row><table:table-cell/>' +
      `${label('Paris')}${label('Lyon')}</table:table-row></table:table-header-rows><table:table-rows>` +
      `<table:table-row>${label('May')}${cell('3')}${cell('1.5')}</table:table-row>` +
      `<table:table-row>${label('June')}${cell('4')}<table:table-cell/></table:table-row>` +
      '</table:table-rows></table:table></chart:chart></office:chart></office:body></office:document-content>'
    expect(await readOpenChart(xml)).toEqual({
      title: 'Visitors',
      chart: 'line',
      series: [
        {
          name: 'Paris',
          points: [
            { x: 'May', y: 3 },
            { x: 'June', y: 4 }
          ]
        },
        { name: 'Lyon', points: [{ x: 'May', y: 1.5 }] }
      ]
    })
  })
})

describe('a paragraph written as Markdown', () => {
  it.each<[string, InlinePart[], string[]]>([
    ['plain text, its marks escaped', [{ text: 'A *star* and a_b' }], ['A \\*star\\* and a\\_b']],
    ['strong text, its spaces outside its marks', [{ text: 'Go ' }, { text: 'now ', bold: true }, { text: 'please' }], ['Go **now** please']],
    [
      'spans set alike, joined',
      [
        { text: 'Al', bold: true },
        { text: 'so', bold: true }
      ],
      ['**Also**']
    ],
    ['slanted text', [{ text: 'a ' }, { text: 'word', italic: true }, { text: '.' }], ['a _word_.']],
    ['slanted text inside a word', [{ text: 'un' }, { text: 'believ', italic: true }, { text: 'able' }], ['un*believ*able']],
    ['strong and slanted text', [{ text: 'both', bold: true, italic: true }], ['**_both_**']],
    ['struck text', [{ text: 'gone', struck: true }], ['~~gone~~']],
    ['a link', [{ text: 'See ' }, { text: 'the plan', link: 'https://example.org/a b(1)' }], ['See [the plan](https://example.org/a%20b%281%29)']],
    ['a link just after an exclamation mark', [{ text: 'Wow!' }, { text: 'here', link: '#top' }], ['Wow\\![here](#top)']],
    ['a figure', [{ text: 'Map: ' }, { figure: 2, alt: 'The [old] town' }], ['Map: ![The \\[old\\] town](figure:2)']],
    ['line breaks, each line set on its own', [{ text: 'one\ntwo', bold: true }], ['**one**', '**two**']],
    ['no empty line for a break at either end', [{ text: '\nmiddle\n' }], ['middle']],
    ['space alone, set as nothing', [{ text: 'a' }, { text: '  ', bold: true }, { text: 'b' }], ['a  b']],
    ['a line starting like a list', [{ text: '1. Not a list' }], ['1\\. Not a list']]
  ])('writes %s', (_, parts, lines) => {
    expect(inlineLines(parts)).toEqual(lines)
  })

  it('joins the items of a list one under the other, and anything else apart', () => {
    expect(joinBlocks(['Intro', '- One', '  - Two', '1. Three', 'After'])).toBe('Intro\n\n- One\n  - Two\n1. Three\n\nAfter')
  })
})
