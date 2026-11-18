import type { Look } from '@repo/protocol'
import { cn } from '../primitives/cn.ts'
import type { Mood } from './life.ts'

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

/** The circumference of the ring, which its dashes are measured against. */
const AROUND = 2 * Math.PI * 8.5

/**
 * The persona's mark in the composer: a ring with a pupil, the core in miniature, drawn after the persona's look so
 * the two read as one: for the lens, a ring of metal round dark glass and a light that is hot at its heart; for the
 * instrument, a ring broken in four round a bright core. It is drawn as one picture so the pupil sits exactly in the
 * middle of its ring at every size and on every screen, and it lives as the core does: it breathes and blinks at
 * rest, leans in while listening, carries a circling arc while thinking, beats while speaking, and asleep it closes
 * and still breathes, slower.
 */
export function Eye({ mood, look = 'hud', className }: { mood: Mood; look?: Look | undefined; className?: string }) {
  // Parts scale about their own centre, which in a drawing has to be asked for.
  const part = '[transform-box:fill-box] origin-center transition-opacity duration-(--duration-calm) motion-reduce:animate-none'
  const lens = look === 'lens'
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cn('size-5 overflow-visible text-accent', className)}>
      {lens ? (
        <circle
          cx="10"
          cy="10"
          r="8.5"
          fill="rgb(0 0 0 / 0.5)"
          stroke="rgb(214 222 236)"
          strokeOpacity={mood === 'asleep' ? 0.3 : 0.5}
          strokeWidth="1.25"
          className={cn(part, RING[mood])}
        />
      ) : (
        // Broken in four, the gaps on the diagonals, as the instrument's rings are broken.
        <g transform="rotate(45 10 10)">
          <circle
            cx="10"
            cy="10"
            r="8.5"
            fill="none"
            stroke="currentColor"
            strokeOpacity={mood === 'asleep' ? 0.45 : 0.75}
            strokeWidth="1"
            strokeDasharray={`${AROUND / 4 - 1.7} 1.7`}
            strokeDashoffset={-0.85}
            className={cn(part, RING[mood])}
          />
        </g>
      )}
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
          strokeDasharray={`${AROUND / 4} ${(AROUND * 3) / 4}`}
          className={cn(part, 'animate-eye-spin')}
        />
      )}
      <g className={cn(part, 'transition-transform', PUPIL[mood])}>
        <circle cx="10" cy="10" r={lens ? 3.4 : 3} fill="currentColor" />
        {/* The light's heart: warm where the lens's lamp burns, cool white in the instrument's core. */}
        <circle cx="10" cy="10" r={lens ? 1.3 : 1.2} fill={lens ? 'rgb(255 226 184)' : 'rgb(236 250 255)'} opacity={mood === 'asleep' ? 0 : 0.9} />
      </g>
    </svg>
  )
}
