import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DocumentLook, DocumentPage, DocumentParagraph } from './document-look.ts'
import { DocumentPages } from './document-view.tsx'
import type { OfficeFigure } from './office-text.ts'

const paragraph = (spans: DocumentParagraph['spans'], more: Partial<DocumentParagraph> = {}): DocumentParagraph => ({
  kind: 'paragraph',
  look: {},
  spans,
  mark: {},
  ...more
})

const page = (more: Partial<DocumentPage>): DocumentPage => ({
  width: 612,
  height: 792,
  number: '1',
  margins: { top: 72, right: 72, bottom: 72, left: 72, header: 36, footer: 36 },
  header: [],
  footer: [],
  notes: [],
  bands: [],
  ...more
})

const shown = (look: DocumentLook, figures: OfficeFigure[] = [], urls = new Map<OfficeFigure, string>()) =>
  renderToStaticMarkup(<DocumentPages look={look} figures={figures} urls={urls} />)

describe('a document shown as it looks', () => {
  it('shows each page at its size and margins, its runs in their look and its text escaped', () => {
    const html = shown({
      pages: [
        page({
          bands: [
            {
              columns: 1,
              gap: 36,
              blocks: [
                paragraph([{ text: '<b>Sales</b> & costs', look: { font: 'Georgia', size: 14, color: '#c00000', bold: true, underline: 'wavy' } }], {
                  look: { align: 'center', before: 6, after: 12, line: { rule: 'exact', value: 18 }, shading: '#fff2cc' },
                  heading: 1
                }),
                paragraph([{ text: 'Next', look: {} }], { look: { before: 3 } })
              ]
            }
          ]
        })
      ],
      endNotes: [],
      text: { font: 'Aptos', size: 11 },
      tab: 36
    })
    expect(html).toContain('width:612pt;min-height:792pt')
    expect(html).toContain('padding-left:72pt;padding-right:72pt')
    expect(html).toContain('&lt;b&gt;Sales&lt;/b&gt; &amp; costs')
    expect(html).toContain('font-family:&#x27;Georgia&#x27;, serif;font-size:14pt;color:#c00000;font-weight:700')
    expect(html).toContain('text-decoration-line:underline;text-decoration-style:wavy')
    expect(html).toContain('role="heading" aria-level="1"')
    expect(html).toContain('text-align:center')
    expect(html).toContain('line-height:18pt;background-color:#fff2cc')
    // The space after one paragraph and before the next are added together, as Word does.
    expect(html).toContain('margin-top:15pt')
  })

  it('writes each page’s number and the count of pages in its header and footer, and its notes at its foot', () => {
    const footer = [
      paragraph([
        { text: 'Page ', look: {} },
        { field: 'page', look: {} },
        { text: ' of ', look: {} },
        { field: 'pages', look: {} }
      ])
    ]
    const html = shown({
      pages: [
        page({
          number: 'iii',
          footer,
          notes: [
            {
              mark: 1,
              blocks: [
                paragraph([
                  { note: 1, look: { position: 'super' } },
                  { text: ' A note.', look: {} }
                ])
              ]
            }
          ]
        }),
        page({ number: 'iv', footer })
      ],
      endNotes: [],
      text: {},
      tab: 36
    })
    expect(html).toContain('<span style="font-weight:400;font-style:normal">iii</span>')
    expect(html).toContain('<span style="font-weight:400;font-style:normal">iv</span>')
    expect(html.match(/>2<\/span>/g)).toHaveLength(2)
    expect(html).toContain('vertical-align:super">1</span>')
    expect(html).toContain('aria-label="Page iii"')
  })

  it('numbers a paragraph with its marker hanging before its text, and lays a tab out to its stop with its leader', () => {
    const html = shown({
      pages: [
        page({
          bands: [
            {
              columns: 2,
              gap: 18,
              blocks: [
                paragraph([{ text: 'Item', look: {} }], { look: { start: 36, firstLine: -18 }, marker: { text: '1.', look: {}, tab: true } }),
                paragraph(
                  [
                    { text: 'Results', look: {} },
                    { tab: true, look: {} },
                    { text: '2', look: {} }
                  ],
                  {
                    look: { tabs: [{ position: 432, align: 'right', leader: 'dot' }] }
                  }
                )
              ]
            }
          ]
        })
      ],
      endNotes: [],
      text: {},
      tab: 36
    })
    expect(html).toContain('column-count:2;column-gap:18pt')
    expect(html).toContain('padding-left:36pt')
    expect(html).toContain('text-indent:-18pt')
    expect(html).toContain('min-width:18pt')
    expect(html).toContain('left:432pt;transform:translateX(-100%)')
    expect(html).toContain('. . . ')
  })

  it('draws tables with their merged cells, borders and shading, and pictures at their size', () => {
    const figure: OfficeFigure = { kind: 'picture', type: 'image/png', bytes: new Uint8Array(), alt: 'A square' }
    const html = shown(
      {
        pages: [
          page({
            bands: [
              {
                columns: 1,
                gap: 36,
                blocks: [
                  {
                    kind: 'table',
                    columns: [100, 50],
                    align: 'center',
                    rows: [
                      {
                        cells: [
                          {
                            columns: 2,
                            rows: 1,
                            shading: '#4472c4',
                            borders: { top: { width: 0.5, style: 'solid', color: '#000000' }, bottom: { width: 0, style: 'solid', color: '#000000' } },
                            insets: { left: 5.4, right: 5.4 },
                            vertical: 'middle',
                            blocks: [paragraph([{ placed: { figure: 0, alt: 'A square', width: 40, height: 20 } }])]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          })
        ],
        endNotes: [],
        text: {},
        tab: 36
      },
      [figure],
      new Map([[figure, 'blob:picture']])
    )
    expect(html).toContain('width:150pt')
    expect(html).toContain('margin-left:auto')
    expect(html).toContain('colSpan="2"')
    expect(html).toContain('background-color:#4472c4;vertical-align:middle;border-top:0.5pt solid #000000')
    expect(html).not.toContain('border-bottom')
    expect(html).toContain('width:40pt;height:20pt')
    expect(html).toContain('src="blob:picture" alt="A square"')
  })
})
