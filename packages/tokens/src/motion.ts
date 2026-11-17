/** How things move. One curve: quick to start, long to settle, never bouncing. */
const curve = [0.22, 1, 0.36, 1] as const

export const motion = {
  /** The curve as Motion takes it, for animations written in code. */
  curve,
  /** The same curve as CSS takes it. */
  ease: `cubic-bezier(${curve.join(', ')})`,
  /** Durations, in milliseconds. Short: smoothness comes from the curve, not from slowness. */
  duration: {
    /** A control answering a pointer or a key. */
    quick: 120,
    /** One state giving way to another, such as the accent changing. */
    calm: 240,
    /** A screen giving way to another. */
    slow: 420
  }
} as const
