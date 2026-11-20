import { type CSSProperties, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { rollOf, SHOWN_LINES } from './roll.ts'

interface SpokenLineProps {
  text: string
  /** When its sound started, by `Date.now()`, and how long it lasts in seconds. Left out, it is shown whole at once. */
  since: number | undefined
  seconds: number | undefined
  /** The voice is held: the words stop where it stopped. */
  paused: boolean
}

/** A word's share of the time a sentence takes: its letters, and the short gap after it. */
const weight = (word: string) => word.length + 2

/** The voice speeds up a little towards the end of what it says: a word is lit a moment before it is reached, never after. */
const AHEAD = 0.92

/** The lines kept for a sentence: no more ever show, so it never runs onto what sits under the core. */
const KEPT: CSSProperties = { maxHeight: `${SHOWN_LINES}lh`, overflow: 'hidden' }

/** A sentence shown whole at once is cut to the lines kept, with an ellipsis. */
const CUT: CSSProperties = { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: SHOWN_LINES, overflow: 'hidden' }

/**
 * A sentence as it is heard. Every word is in place from the start, so nothing reflows, and each one lights up as
 * the voice reaches it: the caption follows the voice, word by word. It shows in two lines at most: a longer one
 * rolls up a line as the voice goes on to the next, so the words being said are always in sight.
 */
export function SpokenLine({ text, since, seconds, paused }: SpokenLineProps) {
  const words = useMemo(() => text.split(/\s+/).filter((word) => word !== ''), [text])
  /** When each word is reached, as a share of the sentence. */
  const marks = useMemo(() => {
    const total = words.reduce((sum, word) => sum + weight(word), 0)
    let before = 0
    return words.map((word) => {
      const mark = before / total
      before += weight(word)
      return mark
    })
  }, [words])
  const timed = since !== undefined && seconds !== undefined && seconds > 0 && !reducedMotion()
  const [lit, setLit] = useState(timed ? 0 : words.length)
  // Time spent held does not count.
  const held = useRef({ total: 0, from: undefined as number | undefined })

  useEffect(() => {
    const at = Date.now()
    if (paused) held.current.from ??= at
    else if (held.current.from !== undefined) {
      held.current.total += at - held.current.from
      held.current.from = undefined
    }
  }, [paused])

  useEffect(() => {
    held.current = { total: 0, from: undefined }
    if (!timed) return setLit(words.length)
    let frame = 0
    const tick = () => {
      const { total, from } = held.current
      const elapsed = (from ?? Date.now()) - since - total
      const share = elapsed / (seconds * 1000 * AHEAD)
      const reached = marks.filter((mark) => mark <= share).length
      setLit(reached)
      if (reached < words.length) frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [timed, since, seconds, marks, words.length])

  // Where each word's line starts decides how far the sentence rolls, measured again when its width changes.
  const lines = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  const [roll, setRoll] = useState(0)
  useEffect(() => {
    const box = lines.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const box = lines.current
    if (!timed || !box) return setRoll(0)
    // Each word's last line, as drawn: a word broken at a hyphen counts on the line it ends on. Measured from the
    // sentence's own top, so a roll under way moves every word alike and changes nothing.
    const top = box.getBoundingClientRect().top
    const tops = [...box.querySelectorAll<HTMLElement>('[data-word]')].map((word) => {
      const parts = word.getClientRects()
      return (parts[parts.length - 1]?.top ?? top) - top
    })
    setRoll(rollOf(tops, lit))
  }, [timed, lit, width])

  return (
    <span className="block" style={timed ? KEPT : undefined}>
      <span
        ref={lines}
        className={cn('relative block', timed && 'transition-transform duration-(--duration-calm) ease-soft')}
        style={timed ? { transform: `translateY(${-roll}px)` } : CUT}
      >
        {words.map((word, index) => (
          // A sentence's words never move, and the same word can come twice: its place is its key. The space before
          // a word stays outside it, so a word never starts on the line before its own.
          <Fragment key={index}>
            {index > 0 ? ' ' : ''}
            <span data-word="" className={cn('transition-opacity duration-(--duration-calm) ease-soft', index < lit ? 'opacity-100' : 'opacity-30')}>
              {word}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  )
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
