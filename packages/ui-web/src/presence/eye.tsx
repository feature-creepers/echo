import type { Look } from '@repo/protocol'
import { useId } from 'react'
import { cn } from '../primitives/cn.ts'
import type { Mood } from './life.ts'

/** Each part's animation in each mood. Only transform and opacity move, so the compositor runs them alone. */
const RING: Record<Mood, string> = {
  idle: 'animate-eye-breathe',
  listening: 'animate-eye-listen opacity-100',
  thinking: 'opacity-30',
  working: 'opacity-45',
  speaking: 'opacity-80',
  asleep: 'animate-eye-breathe [animation-duration:7s]'
}
const PUPIL: Record<Mood, string> = {
  idle: 'animate-eye-blink',
  listening: 'scale-125',
  thinking: 'opacity-80',
  working: 'animate-eye-work',
  speaking: 'animate-eye-speak',
  asleep: 'animate-eye-sleep'
}

/** The circumference of the ring, which its dashes are measured against. */
const AROUND = 2 * Math.PI * 8.5

/**
 * The persona's mark in the composer: a ring with a pupil, the core in miniature, drawn after the persona's look so
 * the two read as one, and living as the core does in each mood. It is one picture so the pupil sits exactly in the
 * middle of its ring at every size and on every screen.
 */
export function Eye({ mood, look }: { mood: Mood; look: Look }) {
  // Parts scale about their own centre, which in a drawing has to be asked for.
  const part = '[transform-box:fill-box] origin-center transition-opacity duration-(--duration-calm) motion-reduce:animate-none'
  const lens = look === 'lens'
  const glow = useId()
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 overflow-visible text-accent">
      {lens ? (
        <>
          <defs>
            <radialGradient id={glow}>
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
              <stop offset="45%" stopColor="currentColor" stopOpacity="0.4" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle
            cx="10"
            cy="10"
            r="8.5"
            fill="rgb(0 0 0 / 0.72)"
            stroke="rgb(140 170 210)"
            strokeOpacity={mood === 'asleep' ? 0.1 : 0.2}
            strokeWidth="0.75"
            className={cn(part, RING[mood])}
          />
          <circle cx="10" cy="10" r="7" fill={`url(#${glow})`} opacity={mood === 'asleep' ? 0.35 : 0.75} className={part} />
        </>
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
      {(mood === 'thinking' || mood === 'working') && (
        <circle
          cx="10"
          cy="10"
          r="8.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          // A quarter of the ring, the rest of it left empty. Working, it steps round rather than glides.
          strokeDasharray={`${AROUND / 4} ${(AROUND * 3) / 4}`}
          className={cn(part, mood === 'working' ? 'animate-eye-step' : 'animate-eye-spin')}
        />
      )}
      <g className={cn(part, 'transition-transform', PUPIL[mood])}>
        {lens ? (
          // The lens's disc: amber, with a little red round it.
          <>
            <circle cx="10" cy="10" r="2.6" fill="currentColor" opacity="0.9" />
            <circle cx="10" cy="10" r="1.7" fill="rgb(255 196 72)" opacity={mood === 'asleep' ? 0.25 : 1} />
          </>
        ) : (
          // The instrument's core: cool white at its heart.
          <>
            <circle cx="10" cy="10" r="3" fill="currentColor" />
            <circle cx="10" cy="10" r="1.2" fill="rgb(236 250 255)" opacity={mood === 'asleep' ? 0 : 0.9} />
          </>
        )}
      </g>
    </svg>
  )
}
