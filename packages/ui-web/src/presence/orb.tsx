import { LOOKS, type Look } from '@repo/protocol'
import { useEffect, useRef } from 'react'
import { cn } from '../primitives/cn.ts'
import { createGpuCore } from './gpu.ts'
import { type Around, createLife, type Mood, type Pose } from './life.ts'
import { createPainter } from './painter.ts'

export interface OrbProps {
  mood: Mood
  /** The side of the square it is drawn in, in CSS pixels. */
  size: number
  /**
   * How loud the voice heard or spoken is right now, from 0 to 1. Asked for at every frame, so the sound
   * can drive the core without the interface being drawn again.
   */
  level?: () => number
  /** The voice's spectrum right now, `BANDS` numbers from 0 to 1 from the low notes to the high. Asked for at every frame. */
  bands?: () => ArrayLike<number> | undefined
  /**
   * Where the core looks, as a direction from its centre across the screen, up as up, each from -1 to 1; nothing
   * when it has nothing to look at. Asked for at every frame.
   */
  gaze?: () => readonly [number, number] | undefined
  /** How hard the computer works, from 0 to 1; nothing when it is not known. Asked for at every frame. */
  load?: () => number | undefined
  /**
   * What is round the core on the screen, which its glass reflects: the pointer, and the view it looks at, in the
   * core's own radii from its middle, up as up. Asked for at every frame.
   */
  around?: () => Around | undefined
  /** Told every pose drawn, so what moves with the core (the light it casts) can follow it in the same frame. */
  onFrame?: (pose: Pose) => void
  /**
   * How large the core is drawn inside its canvas, from 0 to 1 of `size`, read every frame after `onFrame`: a core
   * that changes size is drawn again at each size, sharp, rather than stretched.
   */
  scale?: () => number
  className?: string
}

/** The look drawn before any persona is known: the instrument, which reads as something getting ready. */
const NEUTRAL_LOOK: Look = 'hud'

/**
 * A development switch: `?core=shader` in the page's address draws the core on the graphics card even where only
 * the processor would draw it, so the shaders can be seen on a machine without a graphics card. Nothing in the
 * product sets it.
 */
const forceShader = () => new URLSearchParams(window.location.search).get('core') === 'shader'

/** Reads a CSS colour, whatever way it is written, as red, green and blue from 0 to 255. */
function readColor(probe: CanvasRenderingContext2D, value: string): [number, number, number] {
  probe.fillStyle = '#000'
  probe.fillStyle = value
  probe.clearRect(0, 0, 1, 1)
  probe.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

/** Reads the look the surrounding element asks for, as `--look`. */
function readLook(element: Element): Look {
  const value = getComputedStyle(element).getPropertyValue('--look').trim()
  return (LOOKS as readonly string[]).includes(value) ? (value as Look) : NEUTRAL_LOOK
}

/** A canvas filling its box, made for one drawing and thrown away with it. */
function addCanvas(box: HTMLElement) {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%'
  box.append(canvas)
  return canvas
}

/**
 * The core, in whatever accent and look surround it (`--accent`, and `--look`, which `accentStyle` sets from the
 * persona). It is decoration for a screen reader: the name and the state written beside it say the same thing in
 * words.
 *
 * It is drawn on the graphics card (`gpu.ts`), moved by the life behind it (`life.ts`). Where the graphics card
 * cannot draw it, the same looks are painted on a 2D canvas (`painter.ts`) from the same life. Drawing stops while
 * the window is hidden or the core is out of view, and with less motion asked for, the core holds still and is
 * only drawn again while a mood, a look or an accent changes.
 */
export function Orb({ mood, size, level, bands, gaze, load, around, onFrame, scale, className }: OrbProps) {
  const box = useRef<HTMLSpanElement>(null)
  const live = useRef({ mood, level, size, bands, gaze, load, around, onFrame, scale })
  live.current = { mood, level, size, bands, gaze, load, around, onFrame, scale }

  useEffect(() => {
    const element = box.current
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!element || !probe) return

    // The canvas is made here rather than by React: one that gave the graphics card's context can never give a 2D
    // one, and one whose context was let go cannot be drawn on again, so each drawing gets its own.
    let canvas = addCanvas(element)
    const gpu = createGpuCore(canvas, forceShader())
    let flat: CanvasRenderingContext2D | null = null
    if (!gpu) {
      canvas.remove()
      canvas = addCanvas(element)
      flat = canvas.getContext('2d')
    }
    const painter = createPainter()
    let look = readLook(element)
    const life = createLife(live.current.mood, look)
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Each look keeps the accent it was last shown in, so while one gives way to the other, each fades in its own.
    let target = readColor(probe, getComputedStyle(element).getPropertyValue('--accent').trim() || '#a4adbb')
    const accents = Object.fromEntries(LOOKS.map((each) => [each, [...target]])) as Record<Look, [number, number, number]>
    const shown = Object.fromEntries(LOOKS.map((each) => [each, [...target]])) as Record<Look, [number, number, number]>
    let readAt = performance.now()
    let previous = readAt
    let fading = false
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
      previous = now
      // The accent and the look are whatever the surrounding element says. The look is a word, read every frame so a
      // change of persona morphs the core in the same frame as the rest of the window changes. The accent changes
      // rarely and costs more to read, so it is read a few times a second, and every frame while a look comes in;
      // the colour drawn eases towards each reading.
      const asked = readLook(element)
      if (asked !== look || now - readAt > 200 || fading) {
        target = readColor(probe, getComputedStyle(element).getPropertyValue('--accent').trim() || '#a4adbb')
        // A look coming in starts in the accent it comes with; the one giving way keeps its own.
        if (asked !== look) accents[asked] = [...target]
        look = asked
        readAt = now
      }
      const ease = 1 - Math.exp(-delta * 12)
      accents[look] = accents[look].map((value, channel) => value + ((target[channel] ?? value) - value) * ease) as [number, number, number]
      for (const each of LOOKS) shown[each] = accents[each].map(Math.round) as [number, number, number]

      const heard = Math.max(0, Math.min(1, live.current.level?.() ?? 0))
      const pose = life.step({
        mood: live.current.mood,
        look,
        level: heard,
        bands: live.current.bands?.(),
        gaze: live.current.gaze?.(),
        load: live.current.load?.(),
        around: live.current.around?.(),
        delta,
        still: still.matches
      })
      live.current.onFrame?.(pose)
      const drawnAt = Math.min(1, Math.max(0.05, live.current.scale?.() ?? 1))
      fading = pose.looks[look] < 1
      // Holding still, a frame is only drawn while something changes: the size, the accent, a mood or a look fading.
      const settled = Math.abs(pose.weights[live.current.mood] - 1) < 0.002 && Math.abs(pose.looks[look] - 1) < 0.002
      const state = `${pixels} ${drawnAt.toFixed(3)} ${shown[look].join()} ${live.current.mood} ${look}`
      if (!(still.matches && settled && drawn === state)) {
        if (gpu) gpu.paint(pose, shown, pixels, drawnAt)
        else if (flat) painter.paint(flat, pose, shown, pixels, drawnAt)
        drawn = settled ? state : ''
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
      gpu?.dispose()
      canvas.remove()
    }
  }, [])

  return <span ref={box} aria-hidden="true" className={cn('pointer-events-none block select-none', className)} style={{ width: size, height: size }} />
}
