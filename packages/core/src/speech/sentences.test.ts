import { describe, expect, it } from 'vitest'
import { createSentenceCutter, speakable } from './sentences.ts'

/** Feed the pieces one by one and collect every sentence, with what is left at the end. */
function cut(...pieces: string[]): string[] {
  const cutter = createSentenceCutter()
  return [...pieces.flatMap((piece) => cutter.push(piece)), ...cutter.flush()]
}

describe('the sentence cutter', () => {
  it('gives a sentence as soon as the next one starts', () => {
    const cutter = createSentenceCutter()
    expect(cutter.push('A mushroom risotto would work.')).toEqual([])
    expect(cutter.push(' Forty minutes,')).toEqual(['A mushroom risotto would work.'])
    expect(cutter.push(' and it suits your guest.')).toEqual([])
    expect(cutter.flush()).toEqual(['Forty minutes, and it suits your guest.'])
  })

  it('puts back together a sentence that arrives letter by letter', () => {
    expect(cut(...'Yes. It is done!'.split(''))).toEqual(['Yes.', 'It is done!'])
  })

  it('ends a sentence on a question mark, an exclamation mark and an ellipsis', () => {
    expect(cut('Really? Yes! Well… Fine.')).toEqual(['Really?', 'Yes!', 'Well…', 'Fine.'])
    expect(cut('Wait... Now.')).toEqual(['Wait...', 'Now.'])
  })

  it('keeps the space French puts before a mark, and the closing quote after one', () => {
    expect(cut('Bonjour ! Comment ça va ? Bien.')).toEqual(['Bonjour !', 'Comment ça va ?', 'Bien.'])
    expect(cut('He said "no." Then he left.')).toEqual(['He said "no."', 'Then he left.'])
  })

  it('does not cut after a number, an abbreviation or an initial', () => {
    expect(cut('It costs 3.50 euros. Cheap.')).toEqual(['It costs 3.50 euros.', 'Cheap.'])
    expect(cut('Ask Dr. Watson or Mme. Dupont. They know.')).toEqual(['Ask Dr. Watson or Mme. Dupont.', 'They know.'])
    expect(cut('J. K. Rowling wrote it. In 1997.')).toEqual(['J. K. Rowling wrote it.', 'In 1997.'])
  })

  it('cuts at a line break', () => {
    expect(cut('First line\nSecond line\n\nThird')).toEqual(['First line', 'Second line', 'Third'])
  })

  it('gives nothing for a reply that is only space', () => {
    expect(cut('  ', '\n')).toEqual([])
  })
})

describe('speakable', () => {
  it('leaves plain sentences as they are', () => {
    expect(speakable('It is 3 * 4, or twelve.')).toBe('It is 3 * 4, or twelve.')
  })

  it.each([
    ['**Done.** It is _ready_.', 'Done. It is ready.'],
    ['Run `pnpm install` first.', 'Run pnpm install first.'],
    ['See [the page](https://example.com) for more.', 'See the page for more.'],
    ['- First point', 'First point'],
    ['## A heading', 'A heading']
  ])('removes what is written for the eye in %j', (written, spoken) => {
    expect(speakable(written)).toBe(spoken)
  })
})
