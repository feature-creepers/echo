import { describe, expect, it } from 'vitest'
import { describeSigned } from './signed-installer.ts'

const unsigned = { sha512: 'b2xkL2hhc2grb2YvdGhlL3Vuc2lnbmVkL2luc3RhbGxlcg==', size: 104857600 }
const signed = { sha512: 'bmV3L2hhc2grb2YvdGhlL3NpZ25lZC9pbnN0YWxsZXI=', size: 104869888 }

/** A manifest as electron-builder writes it for the installer. */
const manifest = (file: { sha512: string; size: number }) =>
  `version: 0.2.0
files:
  - url: Echo-0.2.0-setup.exe
    sha512: ${file.sha512}
    size: ${file.size}
path: Echo-0.2.0-setup.exe
sha512: ${file.sha512}
releaseDate: '2026-11-21T10:00:00.000Z'
`

describe('the update manifest of a signed installer', () => {
  it('gives the hash and size of the signed installer wherever it gave those of the unsigned one', () => {
    expect(describeSigned(manifest(unsigned), unsigned, signed)).toBe(manifest(signed))
  })

  it.each([
    { manifestOf: 'another installer', facts: { sha512: 'YW5vdGhlci9pbnN0YWxsZXI=', size: unsigned.size } },
    { manifestOf: 'the same hash with another size', facts: { sha512: unsigned.sha512, size: 99 } }
  ])('is refused for $manifestOf', ({ facts }) => {
    expect(() => describeSigned(manifest(facts), unsigned, signed)).toThrow('does not describe the installer')
  })
})
