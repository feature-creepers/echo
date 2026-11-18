import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { StopGlyph } from '../primitives/icons.tsx'
import { createHold, HOLD_MS } from './hold.ts'

/** How long the hint that a tap does not stop stays, in milliseconds. */
const HINT_MS = 1_600

const HOLD_KEYS = new Set([' ', 'Enter'])

/**
 * The composer's stop: it stops all work, every thread's and the answer on the stage, so it is pressed and held for
 * two seconds, the time filling the button, rather than clicked. A tap only says to hold it. One thread is stopped
 * from the list of what is at work, or from the side sheet.
 */
export function StopAllButton({ working, onStop }: { working: number; onStop(): void }) {
  const [holding, setHolding] = useState(false)
  const [hint, setHint] = useState(false)
  const stopping = useRef(onStop)
  stopping.current = onStop
  const hold = useMemo(() => createHold({ onDone: () => stopping.current(), onChange: setHolding }), [])

  useEffect(() => {
    if (!hint) return
    const timer = setTimeout(() => setHint(false), HINT_MS)
    return () => clearTimeout(timer)
  }, [hint])
  // Leaving the screen mid-press is letting go.
  useEffect(() => () => void hold.release(), [hold])

  const release = () => {
    if (hold.release() === 'tap') setHint(true)
  }
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setHint(false)
    hold.press()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.has(event.key)) return
    // Enter would send the form, and a key held repeats: the hold counts from the first.
    event.preventDefault()
    if (!event.repeat) hold.press()
  }
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (HOLD_KEYS.has(event.key)) release()
  }

  const what = working > 1 ? `all ${working} pieces of work` : 'everything under way'
  // The button is the glyph alone, square like the composer's others. A tap's hint floats above it, so the button
  // never changes width; while held, the fill says what is happening.
  return (
    <span className="relative mb-0.5 ml-0.5 flex">
      {hint && (
        <span
          role="status"
          className="material pointer-events-none absolute right-0 bottom-full mb-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-label text-text-soft"
        >
          Hold to stop
        </span>
      )}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => void hold.release()}
        onClick={(event) => event.preventDefault()}
        aria-label={`Stop ${what}: hold for ${HOLD_MS / 1000} seconds`}
        title={`Hold to stop ${what}`}
        className="relative flex size-8 touch-none select-none items-center justify-center overflow-hidden rounded-md bg-white/[0.08] text-text-soft shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.1)] transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.12] hover:text-text [&_svg]:size-3.5"
      >
        {/* The time held, filling the button from the left. A timer shows time, so it fills evenly; letting go empties
            it with the app's curve. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-danger/35"
          style={{
            transform: `scaleX(${holding ? 1 : 0})`,
            transition: holding ? `transform ${HOLD_MS}ms linear` : 'transform var(--duration-calm) var(--ease-soft)'
          }}
        />
        <span className="relative flex">
          <StopGlyph />
        </span>
      </button>
    </span>
  )
}
