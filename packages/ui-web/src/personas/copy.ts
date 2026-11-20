import type { CommandFailure } from '@repo/client'
import { PERSONA_NAME_MAX_LENGTH, type Stance } from '@repo/protocol'
import type { NameProblem } from './draft.ts'

/**
 * The words the person reads about personas. They are written for a stance, never for a persona:
 * a persona has no text of its own besides the name the person gave it.
 */

/** What each stance does, for someone choosing between them. */
export const stanceCopy: Record<Stance, { label: string; summary: string }> = {
  accommodating: {
    label: 'Goes along with you',
    summary: 'Does what you ask. If it sees a serious problem, it tells you in one sentence and carries on.'
  },
  critical: {
    label: 'Questions you',
    summary: 'Before a move it thinks is a serious mistake, it stops, says why and asks if you are sure. If you insist, it does it.'
  }
}

/** Why a name cannot be kept, said next to the field. */
export const nameProblemCopy: Record<NameProblem, string> = {
  empty: 'Type a name.',
  'too-long': `Keep it to ${PERSONA_NAME_MAX_LENGTH} characters.`,
  characters: 'Use letters from A to Z and digits, with a hyphen between words.',
  taken: 'Each personality needs a name of its own.'
}

/** Why the core did not keep the choice, said next to the button. */
export function refusalCopy(code: CommandFailure): string {
  switch (code) {
    case 'name-taken':
      return nameProblemCopy.taken
    case 'invalid-name':
      return 'One of these names cannot be used.'
    case 'closed':
      return 'The connection to the assistant was lost. Try again in a moment.'
    default:
      return 'That did not work. Try again.'
  }
}
