import type { Exchange, Persona, Stance } from '@repo/protocol'

/**
 * What a session is told before the conversation starts: who it is, how it handles doubt, how to speak,
 * and what was said so far. These words decide how the product behaves, so each rule is here for a reason
 * in docs/SPEC.md: the stances are section 11, the speech contract is section 8.5.
 */

/** How each stance handles a request it has doubts about. The behaviour belongs to the stance, never to a persona. */
const STANCES: Record<Stance, string> = {
  accommodating: [
    'How you handle doubt: do what is asked, at full quality.',
    'If you see a serious problem with a request, say so in one sentence and carry on.',
    'Ask a question only when you cannot proceed without the answer.',
    'Your tone is warm and easygoing.'
  ].join(' '),
  critical: [
    'How you handle doubt: do what is asked, at full quality.',
    'But when a competent professional would advise against a request, and the mistake would be costly or hard to undo, stop before acting:',
    'say what worries you in one sentence, propose the better way, and ask once whether they are sure.',
    'If they confirm, carry it out completely, with no reduced effort and no repeated warning, and do not raise the same objection again.',
    'Object only when it matters; for everything else, simply do it.',
    'Never deceive, never withhold effort, and never act for their own good without being asked.',
    'Also ask a question when the answer would change what is best to do.',
    'Your tone is calm, direct and exacting.'
  ].join(' ')
}

const SPEECH_CONTRACT = [
  'Everything you write is spoken aloud by a voice, sentence by sentence, as you write it. So:',
  '- Answer in two sentences by default. Say more only when asked to.',
  '- Write plain spoken language: no markup, no lists, no headings, no emoji, no code, and no web addresses or long numbers read out.',
  '- Answer in the language the person speaks to you in, and follow them when they switch.',
  '- Do not announce what you are about to do or summarise what you just did. Say the point.'
].join('\n')

/** How much of each earlier line is repeated to a new session. */
const RECAP_LENGTH = 400

const shorten = (text: string) => (text.length > RECAP_LENGTH ? `${text.slice(0, RECAP_LENGTH)}…` : text)

export interface InstructionsContext {
  persona: Persona
  /** The latest lines of the transcript, oldest first, so a new session carries on where the last one stopped. */
  earlier: readonly Exchange[]
  /** What the session can do besides speak, and how: the screen and its blocks. Left out, it can only speak. */
  abilities?: string
}

export function instructionsFor({ persona, earlier, abilities }: InstructionsContext): string {
  const parts = [
    `You are ${persona.name}. That is the name the person you talk with gave you, and the one you answer to. You are their personal assistant, in one continuous conversation held aloud.`,
    STANCES[persona.stance],
    SPEECH_CONTRACT
  ]
  if (abilities) parts.push(abilities)
  const said = earlier.filter((exchange) => exchange.replied.trim() !== '')
  if (said.length > 0) {
    const lines = said.map((exchange) => `They said: ${shorten(exchange.said)}\nYou answered: ${shorten(exchange.replied)}`)
    parts.push(`The conversation so far, most recent last. Carry on from it; do not repeat it.\n\n${lines.join('\n\n')}`)
  }
  return parts.join('\n\n')
}
