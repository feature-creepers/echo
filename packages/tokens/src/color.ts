/** The colours of the interface: a near-black ground, flat surfaces, thin rules. */
export const color = {
  /** Behind everything. */
  ground: '#07090c',
  /** A panel resting on the ground. */
  surface: '#0d1117',
  /** Something resting on a panel. */
  raised: '#141b24',
  /** A line between two areas. */
  rule: '#1e2733',
  /** The edge of something that can be typed in or pressed. */
  ruleStrong: '#334052',
  text: '#e9eef4',
  /** Secondary sentences. */
  textSoft: '#a3afbf',
  /** Labels and hints. The dimmest text that still reads on the ground and on a surface. */
  textFaint: '#7c8898',
  /** Something is wrong and needs attention. */
  danger: '#ff7b72'
} as const

export type ColorName = keyof typeof color
