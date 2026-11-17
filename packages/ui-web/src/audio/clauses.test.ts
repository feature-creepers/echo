import { describe, expect, it } from 'vitest'
import { clauses } from './clauses.ts'

describe('a sentence cut for the voice', () => {
  it('stays whole when it is short', () => {
    expect(clauses('Sunny and mild, a nice day for it.')).toEqual(['Sunny and mild, a nice day for it.'])
  })

  it('is cut where a speaker breathes when it is long, never into tiny pieces, and loses no word', () => {
    const sentence = 'Toulouse is the largest, with about 515,000 people, then Nantes at about 328,000, and Bordeaux at about 268,000.'
    const pieces = clauses(sentence)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join(' ')).toBe(sentence)
    for (const piece of pieces) expect(piece.length).toBeGreaterThanOrEqual(40)
  })

  it('stays whole when a long sentence has nowhere to breathe', () => {
    const sentence = 'This sentence goes on and on without a single comma anywhere in it so that the voice has to make it all at once'
    expect(clauses(sentence)).toEqual([sentence])
  })
})
