import { describe, expect, it } from 'vitest'
import { rollOf } from './roll.ts'

/** Seven words over three lines of 24 px: three on the first, two on each of the others. */
const THREE = [0, 0, 0, 24, 24, 48, 48]

describe('how far a sentence rolls under the eye', () => {
  const cases: [string, readonly number[], number, number][] = [
    ['stays put with no words', [], 0, 0],
    ['stays put on one line, wherever the voice is', [0, 0, 0], 3, 0],
    ['stays put on two lines, to the last word', [0, 0, 24, 24], 4, 0],
    ['stays put before the voice reaches the first word', THREE, 0, 0],
    ['stays put while the voice is on the first line', THREE, 3, 0],
    ['stays put while the voice is on the second line', THREE, 4, 0],
    ['rolls up a line as the voice reaches the third', THREE, 6, 24],
    ['stays on the last two lines once all is said', THREE, 7, 24],
    ['counts a voice past the last word as on the last line', THREE, 12, 24],
    ['rolls two lines when the voice is on the fourth', [0, 24, 48, 72], 4, 48],
    ['measures from the first line, wherever it starts', [6, 6, 30, 54], 4, 24],
    ['rolls by the lines as measured, to a fraction of a pixel', [0, 24.375, 48.75, 73.125], 4, 48.75],
    ['keeps words a fraction of a pixel apart on one line', [0, 0.2, 24.375, 24.4, 48.75], 5, 24.375]
  ]
  it.each(cases)('%s', (_name, tops, reached, roll) => {
    expect(rollOf(tops, reached, 2)).toBe(roll)
  })

  it('keeps the line the voice is on in sight, however many lines show', () => {
    expect(rollOf(THREE, 6, 1)).toBe(48)
    expect(rollOf(THREE, 6, 3)).toBe(0)
  })

  it('never shows fewer lines than it can, even when the voice is on the last', () => {
    // The roll is the top of the first line shown: with two lines shown, never past the line before the last.
    const tops = [0, 24, 48, 72, 96]
    for (let reached = 0; reached <= tops.length; reached++) expect(rollOf(tops, reached, 2)).toBeLessThanOrEqual(72)
  })
})
