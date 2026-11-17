/** Durations, in milliseconds. */
export const motion = {
  /** A control answering a pointer or a key. */
  quick: 120,
  /** One state giving way to another, such as the accent changing. */
  calm: 280,
  /** One breath of the core at rest. */
  breath: 4200
} as const

export type MotionName = keyof typeof motion
