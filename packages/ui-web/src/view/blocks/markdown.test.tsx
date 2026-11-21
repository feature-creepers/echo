import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown.tsx'

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />)

describe('Markdown', () => {
  it.each([
    ['a heading, a level smaller than the view it is in', '# Trip', '<h3', undefined],
    ['strong, slanted and struck text', '**a** *b* ~~c~~', '<strong class="font-semibold">a</strong> <em>b</em> <s', undefined],
    ['a line break where it was written', 'line one\nline two', 'line one<br/>', undefined],
    [
      'a link as its words, not followed',
      '[the site](https://example.org)',
      '<span class="underline decoration-line-strong underline-offset-2">the site</span>',
      'href'
    ],
    ['a picture as its words, never loaded', '![A map](https://example.org/map.png)', 'A map', '<img'],
    ['HTML as nothing', 'before <script>alert(1)</script> after', 'before', '<script'],
    ['a checklist with its boxes', '- [x] tickets\n- [ ] passport', 'size-3 shrink-0 bg-text', '<input'],
    ['a table in a box of its own', '| a | b |\n| --- | --- |\n| 1 | 2 |', '<table', undefined],
    ['a numbered list from its first number', '3. three\n4. four', '<ol start="3"', undefined],
    ['code in its box', '```\nlet a = 1\n```', '<pre', undefined]
  ])('shows %s', (_, text, shown, absent) => {
    const markup = html(text)
    expect(markup).toContain(shown)
    if (absent) expect(markup).not.toContain(absent)
  })
})
