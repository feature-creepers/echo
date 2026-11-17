/**
 * Draws the core: the assistant's presence, and the one thing on screen that glows and moves.
 *
 * It is a set of rings around a bright centre, like echoes of a sound. What the assistant is doing shows in
 * how they move: they breathe at rest, lean in and tremble with the user's voice while listening, carry a
 * light that circles while thinking, and send waves outward with its own voice while speaking.
 */

/** What the assistant is doing, as the core shows it. */
export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking' | 'asleep'

export interface Frame {
  /** Seconds since the core appeared. */
  time: number
  /** Seconds since the previous frame. */
  delta: number
  mood: Mood
  /** How loud the voice being heard or spoken is right now, from 0 to 1. */
  level: number
  /** The accent, as red, green and blue from 0 to 255. */
  accent: readonly [number, number, number]
  /** The side of the square drawn in, in device pixels. */
  size: number
  /** Whether the user asked the system for less motion: the core then holds still. */
  still: boolean
}

/** How far each mood is in effect, from 0 to 1. Moods cross-fade: the core never jumps from one to the next. */
type Weights = Record<Mood, number>

interface Wave {
  /** How far it has travelled, from 0 (the innermost ring) to 1 (gone). */
  progress: number
  strength: number
}

export interface Painter {
  paint(context: CanvasRenderingContext2D, frame: Frame): void
}

const RINGS = [
  { radius: 0.3, alpha: 0.95, width: 1.5 },
  { radius: 0.46, alpha: 0.55, width: 1.25 },
  { radius: 0.62, alpha: 0.3, width: 1 },
  { radius: 0.78, alpha: 0.16, width: 1 }
] as const

/** A slow, uneven wobble around a ring: three waves of different lengths that never line up twice the same way. */
const wobble = (angle: number, time: number, seed: number) =>
  Math.sin(3 * angle + time * 1.3 + seed) * 0.5 + Math.sin(5 * angle - time * 0.9 + seed * 1.7) * 0.3 + Math.sin(8 * angle + time * 2.1 + seed * 0.4) * 0.2

export function createPainter(): Painter {
  const weights: Weights = { idle: 1, listening: 0, thinking: 0, speaking: 0, asleep: 0 }
  const waves: Wave[] = []
  let level = 0
  let sinceWave = 0

  return {
    paint(context, frame) {
      const { time, delta, size, accent, still } = frame
      const [r, g, b] = accent
      const ink = (alpha: number) => `rgb(${r} ${g} ${b} / ${Math.max(0, Math.min(1, alpha))})`

      // Ease every mood towards where it should be, and the level towards what is heard.
      const ease = 1 - Math.exp(-delta * 6)
      for (const mood of Object.keys(weights) as Mood[]) weights[mood] += ((mood === frame.mood ? 1 : 0) - weights[mood]) * ease
      level += (frame.level - level) * (1 - Math.exp(-delta * 14))

      const awake = 1 - weights.asleep * 0.62
      const voice = (weights.listening + weights.speaking) * level
      const centre = size / 2
      const unit = size / 2

      context.clearRect(0, 0, size, size)
      context.globalCompositeOperation = 'lighter'

      // The halo: a soft light behind everything, brighter with the voice.
      const halo = context.createRadialGradient(centre, centre, 0, centre, centre, unit)
      halo.addColorStop(0, ink((0.2 + voice * 0.25 + weights.thinking * 0.06) * awake))
      halo.addColorStop(0.45, ink(0.07 * awake))
      halo.addColorStop(1, ink(0))
      context.fillStyle = halo
      context.fillRect(0, 0, size, size)

      // Waves leave the centre while speaking, more often and stronger the louder the voice.
      sinceWave += delta
      const gap = 0.75 - level * 0.45
      if (!still && weights.speaking > 0.5 && sinceWave > gap) {
        waves.push({ progress: 0, strength: 0.35 + level * 0.65 })
        sinceWave = 0
      }
      for (let index = waves.length - 1; index >= 0; index--) {
        const wave = waves[index]
        if (!wave) continue
        wave.progress += delta / 1.7
        if (wave.progress >= 1) {
          waves.splice(index, 1)
          continue
        }
        const radius = unit * (0.3 + wave.progress * 0.66)
        context.beginPath()
        context.arc(centre, centre, radius, 0, Math.PI * 2)
        context.strokeStyle = ink((1 - wave.progress) ** 2 * 0.55 * wave.strength)
        context.lineWidth = Math.max(1, size / 220)
        context.stroke()
      }

      // The rings. At rest they breathe; with a voice they tremble; while listening they lean in.
      const breath = still ? 0 : Math.sin(time * 0.9) * 0.012 * (1 - weights.asleep * 0.5)
      RINGS.forEach((ring, index) => {
        const lean = 1 - weights.listening * 0.05 * (1 - level) + breath * (1 + index * 0.35)
        const tremble = still ? 0 : 0.006 + voice * (0.05 + index * 0.012) + weights.thinking * 0.004
        const base = unit * ring.radius * lean
        context.beginPath()
        const steps = 96
        for (let step = 0; step <= steps; step++) {
          const angle = (step / steps) * Math.PI * 2
          const radius = base * (1 + tremble * wobble(angle, time, index * 2.1))
          const x = centre + Math.cos(angle) * radius
          const y = centre + Math.sin(angle) * radius
          if (step === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.closePath()
        context.strokeStyle = ink(ring.alpha * awake * (1 - weights.thinking * 0.35))
        context.lineWidth = Math.max(1, (ring.width * size) / 260)
        context.stroke()
      })

      // Thinking: a light circles the second ring, and a fainter one circles the third the other way.
      if (weights.thinking > 0.01) {
        const sweep = (ringIndex: number, speed: number, length: number, strength: number) => {
          const ring = RINGS[ringIndex]
          if (!ring) return
          const head = still ? -Math.PI / 2 : time * speed
          const segments = 28
          for (let segment = 0; segment < segments; segment++) {
            const from = head - (segment / segments) * length
            const to = head - ((segment + 1) / segments) * length
            context.beginPath()
            context.arc(centre, centre, unit * ring.radius, Math.min(from, to), Math.max(from, to))
            context.strokeStyle = ink((1 - segment / segments) ** 2 * strength * weights.thinking)
            context.lineWidth = Math.max(1.5, size / 150)
            context.lineCap = 'round'
            context.stroke()
          }
        }
        sweep(1, 2.6, Math.PI * 0.9, 1)
        sweep(2, -1.7, -Math.PI * 0.6, 0.55)
      }

      // The centre: a bright point that swells with the voice.
      const core = unit * (0.075 + voice * 0.035) * (1 + breath * 2)
      const glow = context.createRadialGradient(centre, centre, 0, centre, centre, core * 3.2)
      glow.addColorStop(0, ink(0.9 * awake))
      glow.addColorStop(0.3, ink(0.42 * awake))
      glow.addColorStop(1, ink(0))
      context.fillStyle = glow
      context.beginPath()
      context.arc(centre, centre, core * 3.2, 0, Math.PI * 2)
      context.fill()

      context.globalCompositeOperation = 'source-over'
      context.beginPath()
      context.arc(centre, centre, core, 0, Math.PI * 2)
      context.fillStyle = `rgb(${Math.round(r + (255 - r) * 0.55)} ${Math.round(g + (255 - g) * 0.55)} ${Math.round(b + (255 - b) * 0.55)} / ${awake})`
      context.fill()
    }
  }
}
