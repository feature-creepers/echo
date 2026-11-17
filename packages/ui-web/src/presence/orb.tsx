import { useEffect, useRef } from 'react'
import { cn } from '../primitives/cn.ts'
import { createPainter, type Mood } from './painter.ts'

export interface OrbProps {
  mood: Mood
  /** The side of the square it is drawn in, in CSS pixels. */
  size: number
  /**
   * How loud the voice heard or spoken is right now, from 0 to 1. Asked for at every frame, so the sound
   * can drive the core without the interface being drawn again.
   */
  level?: () => number
  className?: string
}

/** Reads a CSS colour, whatever way it is written, as red, green and blue from 0 to 255. */
function readColor(probe: CanvasRenderingContext2D, value: string): [number, number, number] {
  probe.fillStyle = '#000'
  probe.fillStyle = value
  probe.clearRect(0, 0, 1, 1)
  probe.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

/**
 * The core, in whatever accent surrounds it. It is decoration for a screen reader: the name and the state
 * written beside it say the same thing in words.
 */
export function Orb({ mood, size, level, className }: OrbProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef({ mood, level })
  live.current = { mood, level }

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!element || !context || !probe) return

    const painter = createPainter()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const started = performance.now()
    let previous = started
    let accent: [number, number, number] = [164, 173, 187]
    let accentReadAt = 0
    let frame = 0

    const draw = (now: number) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const pixels = Math.round(size * ratio)
      // A canvas starts 300 by 150 whatever its box is, so both sides are checked.
      if (element.width !== pixels || element.height !== pixels) {
        element.width = pixels
        element.height = pixels
      }
      // The accent is whatever the surrounding element says it is; it changes rarely, so it is read a few times a second.
      if (now - accentReadAt > 200) {
        accent = readColor(probe, getComputedStyle(element).getPropertyValue('--accent').trim() || '#a4adbb')
        accentReadAt = now
      }
      painter.paint(context, {
        time: (now - started) / 1000,
        delta: Math.min(0.1, (now - previous) / 1000),
        mood: live.current.mood,
        level: Math.max(0, Math.min(1, live.current.level?.() ?? 0)),
        accent,
        size: pixels,
        still: still.matches
      })
      previous = now
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [size])

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a drawing with no handler cannot take the keyboard
    <canvas ref={canvas} aria-hidden="true" className={cn('pointer-events-none select-none', className)} style={{ width: size, height: size }} />
  )
}
