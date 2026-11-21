import { describe, expect, it } from 'vitest'
import { type Answer, answered, answerWords, sentOnPick } from './answers.ts'
import { validateView } from './validate.ts'

/** A Questions block as the catalogue fills it in, from what a model wrote. */
function questionsOf(written: unknown) {
  const checked = validateView({ root: 'q', elements: { q: { type: 'Questions', props: { questions: written } } } })
  if (!checked.ok) throw new Error(checked.problems.join('\n'))
  const props = checked.spec.elements.q?.props as { questions: Parameters<typeof answerWords>[0] } | undefined
  return props?.questions ?? []
}

const widgets = {
  question: 'Rebuild the widgets as apps?',
  options: [{ label: 'Build it', recommended: true }, { label: 'Change the plan first' }]
}
const issues = {
  question: 'What happens to the issues?',
  multiple: true,
  options: [{ label: 'Close the old ones' }, { label: 'Keep the release ones' }, { label: 'Leave them' }]
}
const approval = {
  options: [
    { label: 'Allow once', say: 'Allow once.' },
    { label: 'No', say: 'No.' }
  ],
  other: false
}

const pick = (...picked: number[]): Answer => ({ picked, typed: '' })

describe('the words a questionnaire sends', () => {
  it.each([
    ['one picked answer, after its question', [widgets], [pick(0)], 'Rebuild the widgets as apps? Build it'],
    ['a typed answer in place of one picked', [widgets], [{ picked: [], typed: '  Only the CI widget ' }], 'Rebuild the widgets as apps? Only the CI widget'],
    [
      'several picked answers, and words typed beside them',
      [issues],
      [{ picked: [0, 1], typed: 'and #20' }],
      'What happens to the issues? Close the old ones, Keep the release ones, and #20'
    ],
    [
      'each question on its own line',
      [widgets, issues],
      [pick(1), pick(2)],
      'Rebuild the widgets as apps? Change the plan first\nWhat happens to the issues? Leave them'
    ],
    ['the exact words of an answer that has them, alone', [approval], [pick(0)], 'Allow once.'],
    ['an answer that is not among the answers, never', [widgets], [pick(7)], 'Rebuild the widgets as apps?']
  ])('says %s', (_case, written, answers, words) => {
    expect(answerWords(questionsOf(written), answers)).toBe(words)
  })

  it.each([
    ['one question with one answer to pick', [widgets], true],
    ['one question with several answers to pick', [issues], false],
    ['several questions', [widgets, issues], false]
  ])('sends on the pick for %s: %s', (_case, written, sent) => {
    expect(sentOnPick(questionsOf(written))).toBe(sent)
  })

  it.each([
    [undefined, false],
    [pick(), false],
    [{ picked: [], typed: '   ' }, false],
    [pick(0), true],
    [{ picked: [], typed: 'Later' }, true]
  ])('counts %j as answered: %s', (answer, done) => {
    expect(answered(answer)).toBe(done)
  })
})

describe('a questionnaire as a model writes it', () => {
  it('offers a typed answer and leaves answers unmarked unless told', () => {
    expect(questionsOf([widgets])[0]).toMatchObject({ multiple: false, other: true, options: [{ recommended: true }, { recommended: false }] })
  })

  it('asks that each of several questions be written out', () => {
    const checked = validateView({ root: 'q', elements: { q: { type: 'Questions', props: { questions: [widgets, approval] } } } })
    expect(checked).toEqual({ ok: false, problems: ['"q" (Questions): With several questions, give each its `question`.'] })
  })
})
