import { useEffect, useRef } from 'react'
import { cn } from '../primitives/cn.ts'
import { createLens } from './lens.ts'
import { createLife } from './life.ts'
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

/** A canvas filling its box, made for one drawing and thrown away with it. */
function addCanvas(box: HTMLElement) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  box.append(canvas)
  return canvas
}

/**
 * The core, in whatever accent surrounds it. It is decoration for a screen reader: the name and the state
 * written beside it say the same thing in words.
 *
 * It is drawn as a lens on the graphics card (`lens.ts`), moved by the life behind it (`life.ts`). Where the
 * graphics card cannot draw it, the simpler rings of `painter.ts` stand in. Drawing stops while the window is
 * hidden or the core is out of view, and with less motion asked for, the lens holds still and is only drawn
 * again while a mood fades.
 */
export function Orb({ mood, size, level, className }: OrbProps) {
  const box = useRef<HTMLSpanElement>(null)
  const live = useRef({ mood, level, size })
  live.current = { mood, level, size }

  useEffect(() => {
    const element = box.current
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!element || !probe) return

    // The canvas is made here rather than by React: one that gave the graphics card's context can never give a 2D
    // one, and one whose context was let go cannot be drawn on again, so each drawing gets its own.
    let canvas = addCanvas(element)
    const lens = createLens(canvas)
    let flat: CanvasRenderingContext2D | null = null
    if (!lens) {
      canvas.remove()
      canvas = addCanvas(element)
      flat = canvas.getContext('2d')
    }
    const life = createLife(live.current.mood)
    const painter = createPainter()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const started = performance.now()
    let previous = started
    let accent: readonly number[] = [164, 173, 187]
    let target: readonly number[] | undefined
    let accentReadAt = -Infinity
    let drawn = ''
    let frame = 0
    let onScreen = true

    const draw = (now: number) => {
      frame = 0
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const pixels = Math.round(live.current.size * ratio)
      // A canvas starts 300 by 150 whatever its box is, so both sides are checked.
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels
        canvas.height = pixels
        drawn = ''
      }
      const delta = Math.min(0.1, (now - previous) / 1000)
      // The accent is whatever the surrounding element says it is. It changes rarely, so it is read a few times a
      // second, and the colour drawn eases towards each reading: a change of persona fades as a mood does.
      if (now - accentReadAt > 200) {
        const first = !target
        target = readColor(probe, getComputedStyle(element).getPropertyValue('--accent').trim() || '#a4adbb')
        if (first) accent = target
        accentReadAt = now
      }
      const ease = 1 - Math.exp(-delta * 12)
      accent = accent.map((value, index) => value + ((target?.[index] ?? value) - value) * ease)
      const [red = 0, green = 0, blue = 0] = accent
      const heard = Math.max(0, Math.min(1, live.current.level?.() ?? 0))
      previous = now

      if (lens) {
        const pose = life.step({ mood: live.current.mood, level: heard, delta, still: still.matches })
        // Holding still, a frame is only drawn while something changes: the size, the accent, or a mood fading.
        const settled = Math.abs(pose.weights[live.current.mood] - 1) < 0.002
        const state = `${pixels} ${accent.map(Math.round).join()} ${live.current.mood}`
        if (!(still.matches && settled && drawn === state)) {
          lens.paint(pose, [red, green, blue], pixels)
          drawn = settled ? state : ''
        }
      } else if (flat) {
        painter.paint(flat, {
          time: (now - started) / 1000,
          delta,
          mood: live.current.mood,
          level: heard,
          accent: [red, green, blue],
          size: pixels,
          still: still.matches
        })
      }
      run()
    }

    // Nothing is drawn while the window is hidden or the core is scrolled out of view.
    const run = () => {
      if (!frame && onScreen && document.visibilityState === 'visible') frame = requestAnimationFrame(draw)
    }
    const pause = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return pause()
      // The time away is not lived through: the core picks up where it stopped.
      previous = performance.now()
      run()
    }
    const watch = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true
      if (!onScreen) return pause()
      previous = performance.now()
      run()
    })
    document.addEventListener('visibilitychange', onVisibility)
    watch.observe(element)
    run()

    return () => {
      pause()
      document.removeEventListener('visibilitychange', onVisibility)
      watch.disconnect()
      lens?.dispose()
      canvas.remove()
    }
  }, [])

  return <span ref={box} aria-hidden="true" className={cn('pointer-events-none block select-none', className)} style={{ width: size, height: size }} />
}
