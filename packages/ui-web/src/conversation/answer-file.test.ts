import { describe, expect, it } from 'vitest'
import { answerFileName } from './answer-file.ts'

describe('the name of an exported answer', () => {
  it.each([
    ['Linux file systems compared', 'Linux file systems compared.md'],
    ['  ext4 vs Btrfs:  which one?  ', 'ext4 vs Btrfs which one.md'],
    ['A/B "test" <draft> | notes*', 'A B test draft notes.md'],
    ['Line one\nline two\ttab', 'Line one line two tab.md'],
    ['Trailing dots...', 'Trailing dots.md'],
    ['con', 'con answer.md'],
    ['LPT1', 'LPT1 answer.md'],
    ['', 'Full answer.md'],
    ['???', 'Full answer.md'],
    [undefined, 'Full answer.md']
  ])('%j gives %j', (about, name) => {
    expect(answerFileName(about)).toBe(name)
  })

  it('is cut at a word when the title is long', () => {
    const name = answerFileName(`${'word '.repeat(30)}end`)
    expect(name.length).toBeLessThanOrEqual(83)
    expect(name.endsWith('word.md')).toBe(true)
  })

  it('is cut anywhere when a long title has no space to cut at', () => {
    expect(answerFileName('x'.repeat(120))).toBe(`${'x'.repeat(80)}.md`)
  })
})
