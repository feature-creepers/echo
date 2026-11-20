import { describe, expect, it } from 'vitest'
import { mediaTypeOf } from './files.ts'

describe('the media type of a file', () => {
  it.each([
    ['photo.PNG', 'image/png'],
    ['scan.jpeg', 'image/jpeg'],
    ['report.final.pdf', 'application/pdf'],
    ['notes.md', 'text/markdown'],
    ['README', undefined],
    ['archive.unknown', undefined]
  ])('of %s is %s', (name, type) => {
    expect(mediaTypeOf(name)).toBe(type)
  })
})
