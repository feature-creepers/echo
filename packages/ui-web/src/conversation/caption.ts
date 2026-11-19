import type { Sentence, Speaking } from '@repo/client'
import { useEffect, useState } from 'react'

/**
 * The line shown under the core: the sentence heard now, what was asked while nothing has been said yet, a
 * problem, the last sentence heard, the reply when none was heard on this screen, or nothing.
 */
export type CaptionLine = 'sentence' | 'asked' | 'problem' | 'heard' | 'replied' | 'nothing'

export interface CaptionFacts {
  /** A sentence is being heard now. */
  hearing: boolean
  /** The turn on the stage is at work, or its voice still has sentences to say. */
  busy: boolean
  /** The last exchange, when there is one. */
  last:
    | {
        /** It carries a request to remind of: the person's words, or a scheduled or resumed task's. Not a greeting, a reminder or a ready result. */
        request: boolean
        /** One of its sentences was heard on this screen. */
        heard: boolean
        /** It has a reply. */
        replied: boolean
      }
    | undefined
  /** Something went wrong: the turn failed, or what the person said could not be heard or sent. */
  problem: boolean
}

/**
 * Which line the caption shows. What the person asked is a reminder of what the core works on only until the
 * assistant has said something: once a sentence was heard, the caption stays on what the assistant said, between
 * sentences, while the turn goes on after the voice is done, and once it is over. Their own words never come back.
 */
export function captionOf({ hearing, busy, last, problem }: CaptionFacts): CaptionLine {
  if (hearing) return 'sentence'
  if (busy && last && !last.heard) return last.request ? 'asked' : 'nothing'
  if (problem) return 'problem'
  if (last?.heard) return 'heard'
  if (last?.replied) return 'replied'
  return 'nothing'
}

/** A sentence once heard, with the timing it was heard with, so it stays shown exactly as it ended. */
export interface Heard {
  sentence: Sentence
  since: number | undefined
  seconds: number | undefined
}

/**
 * The last sentence heard, kept once the voice has moved on or stopped: what the caption rests on until a new
 * turn says something.
 */
export function useLastHeard(speaking: Speaking): Heard | undefined {
  const [kept, setKept] = useState<Heard>()
  const { sentence, since, seconds } = speaking
  useEffect(() => {
    if (sentence) setKept({ sentence, since, seconds })
  }, [sentence, since, seconds])
  return sentence ? { sentence, since, seconds } : kept
}
