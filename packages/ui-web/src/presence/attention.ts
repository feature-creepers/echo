import type { TurnId } from '@repo/protocol'
import { useEffect, useState } from 'react'

/** What attention needs to know of a view in the stream. */
export interface Attendable {
  id: string
  turn?: TurnId | undefined
}

/**
 * The view the core looks at, if any: while it says a sentence of an answer, the newest view of that answer, which
 * is the one it is talking about; while an answer is under way and says nothing yet, the newest view that arrived
 * for it, as an eye goes to what just appeared. A view read on opening, or of an earlier topic, is never looked at
 * by itself.
 */
export function attendedView(
  stream: readonly Attendable[],
  spoken: TurnId | undefined,
  answering: TurnId | undefined,
  arrived: readonly string[]
): string | undefined {
  if (spoken !== undefined) {
    const talkedAbout = stream.find((view) => view.turn === spoken)
    if (talkedAbout) return talkedAbout.id
  }
  if (answering !== undefined) {
    const appeared = stream.find((view) => view.turn === answering && arrived.includes(view.id))
    if (appeared) return appeared.id
  }
  return undefined
}

/** How long the core keeps looking at a view once it has stopped talking about it, in milliseconds: a glance stays a moment. */
export const LINGER = 1600

/**
 * A value that stays a moment after it is gone: the view looked at stays looked at for `LINGER` after the core
 * stops talking about it, unless the view itself leaves the stream.
 */
export function useLingering(value: string | undefined, present: (value: string) => boolean, linger = LINGER): string | undefined {
  const [kept, setKept] = useState(value)
  useEffect(() => {
    if (value !== undefined) {
      setKept(value)
      return
    }
    const timer = setTimeout(() => setKept(undefined), linger)
    return () => clearTimeout(timer)
  }, [value, linger])
  return value ?? (kept !== undefined && present(kept) ? kept : undefined)
}
