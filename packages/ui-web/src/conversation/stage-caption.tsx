import type { Exchange } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
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
  /** As large as the core it goes with: large in the middle of an empty stage, small beside the core over the board. */
  size: CaptionSize
  /** How many lines it takes at most, so it never runs onto what is round it; left out, it shows whole. */
  lines: 1 | 2 | undefined
  problem: string | undefined
  /** Under a problem, the way to set up an AI program, when there is none to think with. */
  onSetUpEngine: (() => void) | undefined
}

/** Where what was asked came from, when not from the person just now. */
const ORIGIN: Partial<Record<NonNullable<Exchange['trigger']>, string>> = { task: 'Scheduled', resume: 'Resumed' }

type CaptionSize = 'large' | 'medium' | 'small'

/** The type of what is said, of what was asked, and of the reply, at each size. */
const SAID: Record<CaptionSize, string> = {
  large: 'text-xl leading-snug tracking-[-0.01em]',
  medium: 'text-[0.9375rem] leading-relaxed',
  small: 'text-sm leading-5'
}
const ASKED: Record<CaptionSize, string> = { large: 'text-base leading-relaxed', medium: SAID.medium, small: SAID.small }
const REPLIED: Record<CaptionSize, string> = { large: 'text-lg leading-snug', medium: SAID.medium, small: SAID.small }

const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2' } as const

/** What is said under the core, as `captionOf` decides it: one line at a time, each fading into the next. */
export function Caption({ line, heard, last, paused, size, lines, problem, onSetUpEngine }: CaptionProps) {
  const clamp = lines === undefined ? undefined : CLAMP[lines]
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
          className={cn('text-balance', SAID[size])}
        >
          <SpokenLine text={heard.sentence.text} since={heard.since} seconds={heard.seconds} paused={line === 'sentence' && paused} lines={lines} />
        </motion.p>
      ) : line === 'asked' && last ? (
        <motion.p
          key={`said:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
          // What was asked is a reminder of what the core works on until it says something, not something to read
          // again: quiet, in the lines kept, however long it was.
          className={cn('text-balance text-text-faint', clamp, ASKED[size])}
        >
          {origin && <span className="font-medium text-text-soft">{origin} · </span>}
          {/* Files handed over without a word are named instead. */}
          {last.said === '' ? (last.attached?.map((one) => one.name).join(', ') ?? '') : `“${last.said}”`}
        </motion.p>
      ) : line === 'problem' ? (
        // Only a problem may take more room than one line, in the middle of the stage; beside the small core it keeps to
        // its line too, and shows whole like the rest of what is said there.
        <motion.div
          key="problem"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn('grid gap-3', size !== 'small' && 'justify-items-center')}
        >
          <p className={cn('text-balance text-danger text-sm', size === 'small' ? 'leading-5' : 'leading-relaxed', lines === 1 && clamp)}>{problem}</p>
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
          // In the lines kept, so what rests by the core stays short and never runs onto the cards, whatever was said.
          className={cn('text-balance text-text-soft', clamp, REPLIED[size])}
        >
          {last.replied}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )
}

/** The height of the one line kept beside the small core, in pixels: what is said at the small size. */
const ONE_LINE = 20

/**
 * What is said, kept to one line beside the small core, and whole while pointed at or once pressed, until pressed
 * again or left: then it is drawn on a floating pane over what is under it, so it moves nothing. The pane shows only
 * when there is more than the one line.
 */
export function OneLine({ children }: { children(whole: boolean): ReactNode }) {
  const [pointed, setPointed] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [more, setMore] = useState(false)
  const content = useRef<HTMLSpanElement>(null)
  const whole = pointed || pressed
  useLayoutEffect(() => {
    const element = content.current
    if (!element || !whole) return setMore(false)
    const observer = new ResizeObserver(() => setMore(element.offsetHeight > ONE_LINE * 1.5))
    observer.observe(element)
    return () => observer.disconnect()
  }, [whole])
  return (
    <div className="relative h-5 min-w-0 flex-1" onPointerEnter={() => setPointed(true)} onPointerLeave={() => setPointed(false)}>
      <div className={cn('-inset-x-2.5 -top-1.5 absolute px-2.5 py-1.5', more && 'z-30')}>
        <span
          aria-hidden="true"
          className={cn(
            'material shadow-float pointer-events-none absolute inset-0 rounded-lg transition-opacity duration-(--duration-quick) ease-soft',
            more ? 'opacity-100' : 'opacity-0'
          )}
        />
        <button
          type="button"
          aria-expanded={whole}
          onClick={() => setPressed(!pressed)}
          onBlur={() => setPressed(false)}
          className="relative block w-full text-left outline-none"
        >
          <span ref={content} className="block">
            {children(whole)}
          </span>
        </button>
      </div>
    </div>
  )
}
