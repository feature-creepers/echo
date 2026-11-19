import { describe, expect, it } from 'vitest'
import { type MarkdownList, markdownLists } from './markdown-list.ts'

const item = (text: string, ...lists: MarkdownList[]) => ({ text, lists })
const bullets = (...items: ReturnType<typeof item>[]): MarkdownList => ({ ordered: false, start: 1, items })
const numbers = (start: number, ...items: ReturnType<typeof item>[]): MarkdownList => ({ ordered: true, start, items })

describe('markdownLists', () => {
  it.each<[string, string[], MarkdownList[]]>([
    ['a bulleted list', ['- one', '* two', '+ three'], [bullets(item('one'), item('two'), item('three'))]],
    ['a numbered list, from its first number', ['3. three', '4) four'], [numbers(3, item('three'), item('four'))]],
    [
      'items within items',
      ['- a', '  - a1', '    - a1x', '  - a2', '- b'],
      [bullets(item('a', bullets(item('a1', bullets(item('a1x'))), item('a2'))), item('b'))]
    ],
    [
      'a numbered list keeping its count past bullets within it',
      ['1. First', '  - inner', '1. Second'],
      [numbers(1, item('First', bullets(item('inner'))), item('Second'))]
    ],
    [
      'a list changing from numbers to bullets',
      ['1. One', '1. Two', '- First', '- Second'],
      [numbers(1, item('One'), item('Two')), bullets(item('First'), item('Second'))]
    ],
    ['a tab as an indent', ['- a', '\t- b'], [bullets(item('a', bullets(item('b'))))]],
    ['a list starting indented', ['  - a', '- b'], [bullets(item('a'), item('b'))]],
    ['a task kept as written', ['- [x] tickets'], [bullets(item('[x] tickets'))]]
  ])('reads %s', (_, lines, lists) => {
    expect(markdownLists(lines)).toEqual(lists)
  })
})
