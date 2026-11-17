import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../primitives/cn.ts'

export interface SpokenLineProps {
  text: string
  /** When its sound started, by `Date.now()`, and how long it lasts in seconds. Left out, it is shown whole at once. */
  since: number | undefined
  seconds: number | undefined
  /** The voice is held: the words stop where it stopped. */
  paused: boolean
  className?: string | undefined
}

/** A word's share of the time a sentence takes: its letters, and the short gap after it. */
const weight = (word: string) => word.length + 2

/** The voice speeds up a little towards the end of what it says: a word is lit a moment before it is reached, never after. */
const AHEAD = 0.92

/**
 * A sentence as it is heard. Every word is in place from the start, so nothing moves, and each one lights up as
 * the voice reaches it: the caption follows the voice, word by word.
 */
export function SpokenLine({ text, since, seconds, paused, className }: SpokenLineProps) {
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

  return (
    <span className={className}>
      {words.map((word, index) => (
        // A sentence's words never move, and the same word can come twice: its place is its key.
        <span key={index} className={cn('transition-opacity duration-200 ease-out', index < lit ? 'opacity-100' : 'opacity-30')}>
          {index > 0 ? ' ' : ''}
          {word}
        </span>
      ))}
    </span>
  )
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
