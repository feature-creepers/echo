import { motion } from '@repo/tokens'

/** The app's one curve, for Motion. */
export const EASE = motion.curve

/** How long the usual movements take, in seconds, as Motion counts. */
export const DURATION = {
  quick: motion.duration.quick / 1000,
  calm: motion.duration.calm / 1000,
  slow: motion.duration.slow / 1000
} as const

/**
 * A pane travelling in from an edge of the window, such as the side sheet, and what moves aside with it: the
 * app's curve over a little longer than a fade, as a pane travels further.
 */
export const slide = { duration: 0.34, ease: EASE } as const

/** Something arriving or leaving in place: a fade and a short rise. */
export const settle = { duration: DURATION.calm, ease: EASE } as const

/**
 * What follows the pointer or takes a new place in a list: a spring stiff enough not to lag, damped enough
 * never to bounce.
 */
export const glide = { type: 'spring', stiffness: 520, damping: 46, mass: 0.9 } as const
