import { cn } from '../primitives/cn.ts'
import type { Mood } from './painter.ts'

/** Each part's animation in each mood. Only transform and opacity move, so the compositor runs them alone. */
const RING: Record<Mood, string> = {
  idle: 'animate-eye-breathe',
  listening: 'animate-eye-listen opacity-100',
  thinking: 'opacity-30',
  speaking: 'opacity-80',
  asleep: 'animate-eye-breathe [animation-duration:7s]'
}
const PUPIL: Record<Mood, string> = {
  idle: 'animate-eye-blink',
  listening: 'scale-125',
  thinking: 'opacity-80',
  speaking: 'animate-eye-speak',
  asleep: 'animate-eye-sleep'
}

/**
 * The persona's mark in the composer: a ring with a pupil, the core in miniature. It is drawn as one picture
 * so the pupil sits exactly in the middle of its ring at every size and on every screen, and it lives as the
 * core does: it breathes and blinks at rest, leans in while listening, carries a circling arc while thinking,
 * beats while speaking, and asleep it closes and still breathes, slower.
 */
export function Eye({ mood, className }: { mood: Mood; className?: string }) {
  // Parts scale about their own centre, which in a drawing has to be asked for.
  const part = '[transform-box:fill-box] origin-center transition-opacity duration-(--duration-calm) motion-reduce:animate-none'
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cn('size-5 overflow-visible text-accent', className)}>
      <circle
        cx="10"
        cy="10"
        r="8.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity={mood === 'asleep' ? 0.45 : 0.75}
        strokeWidth="1"
        className={cn(part, RING[mood])}
      />
      {mood === 'thinking' && (
        <circle
          cx="10"
          cy="10"
          r="8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          // A quarter of the ring, the rest of it left empty.
          strokeDasharray="13.35 40.06"
          className={cn(part, 'animate-eye-spin')}
        />
      )}
      <circle cx="10" cy="10" r="3" fill="currentColor" className={cn(part, 'transition-transform', PUPIL[mood])} />
    </svg>
  )
}
