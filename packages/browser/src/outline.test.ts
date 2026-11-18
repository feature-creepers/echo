import { describe, expect, it } from 'vitest'
import { changesBetween, outlineOf, outlineText, readLine } from './outline.ts'

/** A page as Playwright's snapshot for AI writes it. */
const SNAPSHOT = `- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - navigation [ref=e3]:
      - link "Home" [ref=e4] [cursor=pointer]:
        - /url: /
        - img "Home" [ref=e5]
      - link [ref=e6] [cursor=pointer]: Cart
  - main [ref=e7]:
    - heading "Test shop" [level=1] [ref=e8]
    - paragraph [ref=e9]: The finest widgets.
    - generic [ref=e10]:
      - textbox "Email" [ref=e11]
      - textbox "Password" [ref=e12]
      - button "Sign in" [ref=e13] [cursor=pointer]
    - checkbox "Remember me" [checked] [ref=e14]
    - combobox "Colour" [ref=e15]:
      - option "Red" [selected]
      - option "Blue"
    - button "Say \\"hi\\"" [disabled] [ref=e16]
  - contentinfo [ref=e17]:
    - text: Footer`

describe('reading a line of a snapshot', () => {
  it.each([
    ['      - textbox "Email" [ref=e11]', { depth: 3, role: 'textbox', name: 'Email', ref: 'e11', shown: '- textbox "Email" [ref=e11]' }],
    ['- link [ref=e6] [cursor=pointer]: Cart', { depth: 0, role: 'link', name: '', ref: 'e6', shown: '- link [ref=e6]: Cart' }],
    [
      '- heading "Test shop" [level=1] [ref=e8]',
      { depth: 0, role: 'heading', name: 'Test shop', ref: 'e8', shown: '- heading "Test shop" [level=1] [ref=e8]' }
    ],
    [
      '- checkbox "Remember me" [checked] [ref=e14]',
      { depth: 0, role: 'checkbox', name: 'Remember me', ref: 'e14', shown: '- checkbox "Remember me" [checked] [ref=e14]' }
    ],
    [
      '- button "Say \\"hi\\"" [disabled] [ref=e16]',
      { depth: 0, role: 'button', name: 'Say "hi"', ref: 'e16', shown: '- button "Say "hi"" [disabled] [ref=e16]' }
    ],
    ['- option "Red" [selected]', { depth: 0, role: 'option', name: 'Red', ref: undefined, shown: '- option "Red" [selected]' }]
  ])('reads %j', (line, read) => {
    expect(readLine(line)).toEqual(read)
  })

  it.each(['        - /url: /', 'Footer', ''])('reads %j as no element', (line) => {
    expect(readLine(line)).toBeUndefined()
  })
})

describe('the outline of a page', () => {
  const outline = outlineOf(SNAPSHOT)

  it('keeps what can be used and the headings and landmarks around it, nested as on the page', () => {
    expect(outline.lines).toEqual([
      '- navigation [ref=e3]',
      '  - link "Home" [ref=e4]',
      '  - link [ref=e6]: Cart',
      '- main [ref=e7]',
      '  - heading "Test shop" [level=1] [ref=e8]',
      '  - textbox "Email" [ref=e11]',
      '  - textbox "Password" [ref=e12]',
      '  - button "Sign in" [ref=e13]',
      '  - checkbox "Remember me" [checked] [ref=e14]',
      '  - combobox "Colour" [ref=e15]',
      '    - option "Red" [selected]',
      '    - option "Blue"',
      '  - button "Say "hi"" [disabled] [ref=e16]'
    ])
  })

  it('knows the role and name of every reference, kept or not', () => {
    expect(outline.refs.get('e12')).toEqual({ role: 'textbox', name: 'Password' })
    expect(outline.refs.get('e9')).toEqual({ role: 'paragraph', name: '' })
    expect(outline.refs.has('e99')).toBe(false)
  })

  it('is cut at a whole line when it is too long, and says so', () => {
    expect(outlineText(outline, 10_000).cut).toBe(false)
    const short = outlineText(outline, 60)
    expect(short).toEqual({ text: '- navigation [ref=e3]\n  - link "Home" [ref=e4]', cut: true })
  })
})

describe('what an action changed', () => {
  it('is the lines that are new, without their indentation, focus aside', () => {
    const before = ['- main [ref=e7]', '  - textbox "Search" [ref=e11]', '  - button "Go" [ref=e12]']
    const after = [
      '- main [ref=e7]',
      '  - textbox "Search" [active] [ref=e11]: lyon',
      '  - textbox "Search" [active] [ref=e11]',
      '  - link "Lyon weather" [ref=e20]'
    ]
    expect(changesBetween(before, after)).toEqual(['- textbox "Search" [active] [ref=e11]: lyon', '- link "Lyon weather" [ref=e20]'])
  })
})
