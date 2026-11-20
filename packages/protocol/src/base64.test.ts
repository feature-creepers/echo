import { describe, expect, it } from 'vitest'
import { decodeBase64, encodeBase64 } from './base64.ts'

const bytes = (...values: number[]) => new Uint8Array(values)
/** The bytes of a text of ASCII characters. */
const text = (value: string) => Uint8Array.from(value, (character) => character.charCodeAt(0))

describe('base64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy']
  ])('writes "%s" as "%s" and reads it back', (plain, written) => {
    expect(encodeBase64(text(plain))).toBe(written)
    expect(decodeBase64(written)).toEqual(text(plain))
  })

  it('carries every byte value', () => {
    const all = new Uint8Array(256).map((_, index) => index)
    const written = encodeBase64(all)
    expect(written.endsWith('/w==')).toBe(true)
    expect(decodeBase64(written)).toEqual(all)
  })

  it('carries a file longer than one slice of the encoder', () => {
    const long = new Uint8Array(40_000).map((_, index) => (index * 31) % 256)
    expect(decodeBase64(encodeBase64(long))).toEqual(long)
  })

  it.each([
    ['a length that is not a multiple of four', 'Zm9'],
    ['a character outside base64', 'Zm9*'],
    ['padding in the middle', 'Zg==Zm9v'],
    ['too much padding', 'A==='],
    ['a character beyond ASCII', 'Zm9é']
  ])('refuses %s', (_, written) => {
    expect(decodeBase64(written)).toBeUndefined()
  })

  it('reads the bytes of a picture as they were', () => {
    expect(decodeBase64('iVBORw0KGgo=')).toEqual(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
  })
})
