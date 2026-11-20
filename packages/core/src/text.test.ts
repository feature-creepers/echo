import { describe, expect, it } from 'vitest'
import { cutText, shorten } from './text.ts'

describe('shortening a text to one line', () => {
  it.each([
    ['short', 'abc', 5, 'abc'],
    ['exactly at the limit', 'abcde', 5, 'abcde'],
    ['over the limit', 'abcdefg', 5, 'abcd…'],
    ['its spaces made single', '  a \n\n b  ', 5, 'a b'],
    ['with no space before the ellipsis', 'abc defgh', 5, 'abc…']
  ])('%s', (_name, text, most, expected) => {
    expect(shorten(text, most)).toBe(expected)
  })
})

describe('cutting a text', () => {
  it.each([
    ['short', 'abc', 5, 'abc'],
    ['exactly at the limit', 'abcde', 5, 'abcde'],
    ['over the limit', 'abcdefg', 5, 'abcde\n[…cut]']
  ])('%s', (_name, text, most, expected) => {
    expect(cutText(text, most)).toBe(expected)
  })
})
