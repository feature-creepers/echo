import { describe, expect, it } from 'vitest'
import { fittedSize, renamedFor } from './fit-for-model.ts'
import { pastedName, refusalOf } from './use-attachments.ts'

describe('a picture made to fit a model', () => {
  it.each([
    [3200, 2400, 2000, 1500],
    [2400, 3200, 1500, 2000],
    [1200, 800, 1200, 800],
    [10000, 3, 2000, 1]
  ])('of %i by %i is made %i by %i', (width, height, fittedWidth, fittedHeight) => {
    expect(fittedSize(width, height)).toEqual({ width: fittedWidth, height: fittedHeight })
  })

  it('takes the extension of the kind it was written as', () => {
    expect(renamedFor('photo.png', 'image/png', 'image/png')).toBe('photo.png')
    expect(renamedFor('photo.png', 'image/png', 'image/webp')).toBe('photo.webp')
    expect(renamedFor('scan', 'image/jpeg', 'image/jpeg')).toBe('scan')
    expect(renamedFor('scan', 'image/png', 'image/jpeg')).toBe('scan.jpg')
  })
})

describe('the composer’s files', () => {
  it('names a pasted picture for when it was pasted', () => {
    expect(pastedName(new Date(2026, 10, 18, 9, 5, 7), 'image/png')).toBe('Pasted image 09.05.07.png')
    expect(pastedName(new Date(2026, 10, 18, 14, 0, 0), 'image/jpeg')).toBe('Pasted image 14.00.00.jpg')
    expect(pastedName(new Date(2026, 10, 18, 14, 0, 0), 'image/svg+xml')).toBe('Pasted image 14.00.00.svg')
  })

  it.each([
    [3, 10, [], undefined],
    [11, 10, [], 'Only 10 files can go with one message.'],
    [2, 1, [], 'Only 10 files can go with one message.'],
    [1, 10, ['big.zip'], 'big.zip is over 25 MB, the most a file can be.'],
    [12, 10, ['a.zip', 'b.zip'], '2 files are over 25 MB, the most a file can be. Only 10 files can go with one message.']
  ])('given %i that fit with room for %i, and %j too large, says %j', (count, room, tooLarge, said) => {
    expect(refusalOf(count, room, tooLarge)).toBe(said)
  })
})
