import type { BlockProps } from './view.ts'

type Question = BlockProps<'Questions'>['questions'][number]

/** What the person gave to one question: the answers they picked, by their place, and what they typed. */
export interface Answer {
  picked: readonly number[]
  typed: string
}

/** Whether a question has an answer to send: one picked, or words typed. */
export const answered = (answer: Answer | undefined) => answer !== undefined && (answer.picked.length > 0 || answer.typed.trim() !== '')

/**
 * The person's answers to a Questions block, as the words they send (docs/SPEC.md, section 9.6): each question followed
 * by its answers, a line each. An answer given its own `say` is said as it is, so a card that waits for exact words,
 * an approval's, gets them.
 */
export function answerWords(questions: readonly Question[], answers: readonly (Answer | undefined)[]): string {
  const lines = questions.map((question, index) => {
    const answer = answers[index]
    const picked = (answer?.picked ?? []).flatMap((place) => {
      const option = question.options[place]
      return option ? [option] : []
    })
    const typed = answer?.typed.trim() ?? ''
    const only = picked[0]
    if (picked.length === 1 && only?.say !== undefined && typed === '')
      return questions.length === 1 ? only.say : `${question.question ?? ''} ${only.say}`.trim()
    const parts = [...picked.map((option) => option.say ?? option.label), ...(typed === '' ? [] : [typed])]
    return `${question.question ?? ''} ${parts.join(', ')}`.trim()
  })
  return lines.join('\n')
}

/** Whether picking an answer sends it at once: one question, with one answer to pick. */
export const sentOnPick = (questions: readonly Question[]) => questions.length === 1 && questions[0]?.multiple !== true
