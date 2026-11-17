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
    'When you have the raise_concern tool, object with it: it shows the person the two ways forward. Once they decide, call record_decision.',
    'Your tone is calm, direct and exacting.'
  ].join(' ')
}

/** The tone of each stance, for a session that routes and does not decide anything itself. */
const TONES: Record<Stance, string> = {
  accommodating: 'Your tone is warm and easygoing.',
  critical: 'Your tone is calm, direct and exacting.'
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

const recap = (earlier: readonly Exchange[]): string | undefined => {
  const said = earlier.filter((exchange) => exchange.replied.trim() !== '')
  if (said.length === 0) return undefined
  const lines = said.map((exchange) => `They said: ${shorten(exchange.said)}\nYou answered: ${shorten(exchange.replied)}`)
  return `The conversation so far, most recent last. Carry on from it; do not repeat it.\n\n${lines.join('\n\n')}`
}

const who = (persona: Persona) =>
  `You are ${persona.name}. That is the name the person you talk with gave you, and the one you answer to. You are their personal assistant, in one continuous conversation held aloud.`

export interface InstructionsContext {
  persona: Persona
  /** The latest lines of the transcript, oldest first, so a new session carries on where the last one stopped. */
  earlier: readonly Exchange[]
  /** What the session can do besides speak, and how: the screen and its blocks. Left out, it can only speak. */
  abilities?: string
  /** What the assistant knows about the person, from its memory. */
  profile?: string | undefined
}

const known = (profile: string | undefined) =>
  profile ? `What you know about the person, from your memory. Use it naturally; do not recite it.\n\n${profile}` : undefined

/** A session that answers on its own, with no orchestrator: used when there are no tools to route with. */
export function instructionsFor({ persona, earlier, abilities, profile }: InstructionsContext): string {
  const parts = [who(persona), STANCES[persona.stance], SPEECH_CONTRACT]
  if (abilities) parts.push(abilities)
  const memory = known(profile)
  if (memory) parts.push(memory)
  const before = recap(earlier)
  if (before) parts.push(before)
  return parts.join('\n\n')
}

/**
 * The orchestrator hears everything the user says. It answers small things at once and hands the rest to a
 * thread: a session working on one topic, with the screen. It never does a thread's work itself, so it can
 * stay fast. docs/SPEC.md, section 7.
 */
export function orchestratorInstructions({ persona, earlier, abilities, profile }: InstructionsContext): string {
  const parts = [
    who(persona),
    TONES[persona.stance],
    SPEECH_CONTRACT,
    [
      'How you work',
      '',
      'Behind the one conversation, work is done in threads: each thread is a session of its own working on one topic, with the screen to show things on. You decide, for each thing the person says, who answers. Each message you receive starts with the list of threads, then what the person said.',
      '',
      '- Small talk, a greeting, a one-line fact, a thank you: answer yourself, in a sentence, and call no tool.',
      '- Anything that needs work, detail, the screen, or that continues a topic: call thread_send with the thread it belongs to, or thread_open for a new topic. Then write nothing at all: the thread answers the person itself.',
      '- A quick question unrelated to the topic on screen, often after "by the way": call thread_open with kind "aside". Its answer appears in a small card beside the current topic, which stays on screen.',
      '- "Back to…", "show me … again": call thread_focus with that thread, then say in a few words that it is back.',
      '- When in doubt whether something belongs to an existing thread, prefer it: topics come back.',
      '- Never object, warn or ask whether they are sure yourself: pass the request to a thread, which weighs it and has the means to object properly.',
      "- Pass the request on in the person's own words, adding only what the thread could not know from its own history."
    ].join('\n')
  ]
  if (abilities) parts.push(abilities)
  const memory = known(profile)
  if (memory) parts.push(memory)
  const before = recap(earlier)
  if (before) parts.push(before)
  return parts.join('\n\n')
}

export interface ThreadContext extends InstructionsContext {
  title: string
  kind: 'topic' | 'aside'
}

/** A thread works on one topic, speaks its answers directly, and shows what is detailed on the screen. */
export function threadInstructions({ persona, earlier, abilities, profile, title, kind }: ThreadContext): string {
  const parts = [
    who(persona),
    STANCES[persona.stance],
    SPEECH_CONTRACT,
    kind === 'aside'
      ? `You are answering a side question: "${title}". Answer it in a sentence or two. If something helps to see, show a small view: it appears as a card in the margin, beside the topic on screen, so keep it to a few blocks.`
      : `In this part of the conversation you work on one topic: "${title}". The person may come back to it later, from other topics, and you will carry on where you stopped. Requests reach you through the assistant that hears everything; answer the person directly, as yourself.`
  ]
  if (abilities) parts.push(abilities)
  const memory = known(profile)
  if (memory) parts.push(memory)
  const before = recap(earlier)
  if (before) parts.push(before)
  return parts.join('\n\n')
}
