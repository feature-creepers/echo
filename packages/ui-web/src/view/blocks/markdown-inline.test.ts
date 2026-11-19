import { describe, expect, it } from 'vitest'
import { plain } from '../../files/office-text.ts'
import { type InlineStep, inlineSteps, picturesOnly, tableCells } from './markdown-inline.ts'

const text = (value: string): InlineStep => ({ type: 'text', text: value })

describe('inlineSteps', () => {
  it.each<[string, string, InlineStep[]]>([
    ['plain text', 'Just words.', [text('Just words.')]],
    ['strong text', 'A **bold** word', [text('A '), { type: 'strong', steps: [text('bold')] }, text(' word')]],
    ['strong text with underscores', '__bold__', [{ type: 'strong', steps: [text('bold')] }]],
    ['emphasis', 'An *odd* one', [text('An '), { type: 'emphasis', steps: [text('odd')] }, text(' one')]],
    ['emphasis inside a word with stars', 'un*believ*able', [text('un'), { type: 'emphasis', steps: [text('believ')] }, text('able')]],
    ['emphasis with underscores', 'An _odd_ one', [text('An '), { type: 'emphasis', steps: [text('odd')] }, text(' one')]],
    ['underscores inside a word', 'a snake_case_name', [text('a snake_case_name')]],
    ['struck text', 'not ~~this~~', [text('not '), { type: 'struck', steps: [text('this')] }]],
    [
      'emphasis inside strong text',
      '**bold _and_ odd**',
      [{ type: 'strong', steps: [text('bold '), { type: 'emphasis', steps: [text('and')] }, text(' odd')] }]
    ],
    ['single stars inside strong text', '**a *b* c**', [{ type: 'strong', steps: [text('a '), { type: 'emphasis', steps: [text('b')] }, text(' c')] }]],
    ['strong and emphasis at once', '***both***', [{ type: 'strong', steps: [{ type: 'emphasis', steps: [text('both')] }] }]],
    ['emphasis inside strong text, the way documents are written', '**_both_**', [{ type: 'strong', steps: [{ type: 'emphasis', steps: [text('both')] }] }]],
    ['code, its marks as they are', 'run `a *b* c`', [text('run '), { type: 'code', text: 'a *b* c' }]],
    [
      'a link, its words read',
      'see [the **plan**](https://example.org/a)',
      [text('see '), { type: 'link', address: 'https://example.org/a', steps: [text('the '), { type: 'strong', steps: [text('plan')] }] }]
    ],
    ['a picture', 'before ![A map](figure:2) after', [text('before '), { type: 'picture', alt: 'A map', address: 'figure:2' }, text(' after')]],
    ['a picture with no words', '![](figure:0)', [{ type: 'picture', alt: '', address: 'figure:0' }]],
    ['escaped marks, as themselves', 'Visit the \\*Forum\\* \\# 1 \\[now\\] a\\_b \\| c \\\\ d', [text('Visit the *Forum* # 1 [now] a_b | c \\ d')]],
    ['an escaped mark inside strong text', '**a \\* b**', [{ type: 'strong', steps: [text('a * b')] }]],
    ['a backslash before a letter stays', 'C:\\Users', [text('C:\\Users')]],
    ['a lone star stays', '2 * 3 = 6', [text('2 * 3 = 6')]],
    ['a star after a space opens nothing', '* not a list here *', [text('* not a list here *')]],
    ['an escaped bracket after an exclamation mark is no picture', '!\\[x](y)', [text('![x](y)')]]
  ])('reads %s', (_, line, steps) => {
    expect(inlineSteps(line)).toEqual(steps)
  })
})

describe('picturesOnly', () => {
  it.each<[string, boolean]>([
    ['![a](figure:0)', true],
    ['![a](figure:0) ![b](figure:1)', true],
    ['![a](figure:0) and text', false],
    ['text', false],
    ['', false]
  ])('says whether %j holds only pictures', (line, expected) => {
    expect(picturesOnly(inlineSteps(line))).toBe(expected)
  })
})

describe('tableCells', () => {
  it.each<[string, string[]]>([
    ['| a | b |', ['a', 'b']],
    ['| 40 \\| 50 | b |', ['40 \\| 50', 'b']],
    ['|a|b', ['a', 'b']],
    ['| a | ends with \\| |', ['a', 'ends with \\|']]
  ])('splits %j at its pipes, not its escaped ones', (line, cells) => {
    expect(tableCells(line)).toEqual(cells)
  })
})

describe('text written plain', () => {
  it.each([
    'Visit the *Forum* & eat',
    'snake_case and __dunder__',
    '~~not struck~~ and `not code`',
    '[not a link](https://example.org) ![nor a picture](figure:0)',
    'C:Usersme\notes.txt',
    'a | b <c> #1'
  ])('reads %j back as it was', (written) => {
    expect(inlineSteps(plain(written))).toEqual([text(written)])
  })
})
