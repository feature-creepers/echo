/** How things move. One curve: quick to start, long to settle, never bouncing. */
export const motion = {
  ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
  /** Durations, in milliseconds. */
  duration: {
    /** A control answering a pointer or a key. */
    quick: 140,
    /** One state giving way to another, such as the accent changing. */
    calm: 320,
    /** A screen giving way to another. */
    slow: 640
  }
} as const
