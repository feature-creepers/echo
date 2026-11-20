import type { Exchange } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '../primitives/cn.ts'
import { DURATION, EASE, settle } from '../styles/motion.ts'
import type { CaptionLine, Heard } from './caption.ts'
import { SpokenLine } from './spoken-line.tsx'

interface CaptionProps {
  line: CaptionLine
  /** The sentence heard now, else the last one heard. */
  heard: Heard | undefined
  /** The last exchange of the conversation. */
  last: Exchange | undefined
  /** The voice is held: the words stop where it stopped. */
  paused: boolean
  /** Over the stream, what is said is smaller; at home and on an empty stage, as large as the core is. */
  compact: boolean
  problem: string | undefined
  /** Under a problem, the way to set up an AI program, when there is none to think with. */
  onSetUpEngine: (() => void) | undefined
}

/** Where what was asked came from, when not from the person just now. */
const ORIGIN: Partial<Record<NonNullable<Exchange['trigger']>, string>> = { task: 'Scheduled', resume: 'Resumed' }

/** What is said under the core, as `captionOf` decides it: one line at a time, each fading into the next. */
export function Caption({ line, heard, last, paused, compact, problem, onSetUpEngine }: CaptionProps) {
  const origin = last?.trigger === undefined ? undefined : ORIGIN[last.trigger]
  return (
    <AnimatePresence mode="wait">
      {(line === 'sentence' || line === 'heard') && heard ? (
        // The sentence heard stays as it ended once the voice moves on, under the same key, so it does not blink
        // between sentences and stays there once all is said.
        <motion.p
          key={`${heard.sentence.turn}:${heard.sentence.text}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          // A sentence leaves quickly, so the next one is shown as its sound starts.
          exit={{ opacity: 0, y: -3, transition: { duration: DURATION.quick, ease: EASE } }}
          transition={settle}
          className={cn('text-balance', compact ? 'text-[0.9375rem] leading-relaxed' : 'text-xl leading-snug tracking-[-0.01em]')}
        >
          <SpokenLine text={heard.sentence.text} since={heard.since} seconds={heard.seconds} paused={line === 'sentence' && paused} />
        </motion.p>
      ) : line === 'asked' && last ? (
        <motion.p
          key={`said:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
          // What was asked is a reminder of what the core works on until it says something, not something to read
          // again: two quiet lines at most, wherever it is shown, however long it was.
          className={cn('line-clamp-2 text-balance text-text-faint', compact ? 'text-[0.9375rem] leading-relaxed' : 'text-base leading-relaxed')}
        >
          {origin && <span className="font-medium text-text-soft">{origin} · </span>}
          {/* Files handed over without a word are named instead. */}
          {last.said === '' ? (last.attached?.map((one) => one.name).join(', ') ?? '') : `“${last.said}”`}
        </motion.p>
      ) : line === 'problem' ? (
        <motion.div key="problem" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid justify-items-center gap-3">
          <p className="text-balance text-danger text-sm leading-relaxed">{problem}</p>
          {onSetUpEngine && (
            <button type="button" onClick={onSetUpEngine} className="w-fit text-accent text-xs hover:underline hover:underline-offset-4">
              Set up an AI program
            </button>
          )}
        </motion.div>
      ) : line === 'replied' && last ? (
        // The reply, when none of its sentences was heard here: on opening, or once the voice was cut.
        <motion.p
          key={`last:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Two lines at most: over the stream, the room kept for the caption, so it never runs onto the cards; at
          // home, so what rests under the core stays a few lines, whatever was said.
          className={cn('line-clamp-2 text-balance text-text-soft', compact ? 'text-[0.9375rem] leading-relaxed' : 'text-lg leading-snug')}
        >
          {last.replied}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}
