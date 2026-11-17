/**
 * The colours of the interface: a near-black ground with a hint of blue, flat layers that rise from it,
 * hairlines between them, and three weights of text.
 */
export const color = {
  /** Behind everything. */
  ground: '#05070a',
  /** A panel resting on the ground. */
  surface: '#0a0d12',
  /** Something resting on a panel: a field, a row under the pointer. */
  raised: '#10141b',
  /** Something floating over the rest: a sheet, a menu. */
  overlay: '#161b24',
  /** A hairline between two areas. A wash of white, so it reads on every layer. */
  line: 'rgb(255 255 255 / 0.07)',
  /** The faintest rule: the squares of the graph paper behind everything. */
  lineFaint: 'rgb(255 255 255 / 0.028)',
  /** The edge of something that can be typed in or pressed. */
  lineStrong: 'rgb(255 255 255 / 0.14)',
  text: '#edf0f5',
  /** Secondary sentences. */
  textSoft: '#a4adbb',
  /** Labels and hints: the dimmest text that still reads on every layer. */
  textFaint: '#7a8496',
  /** Something is wrong and needs attention. */
  danger: '#ff7a70',
  /** Something went through. */
  ok: '#5fd39b',
  /** Something to keep an eye on. */
  warn: '#f0c05a'
} as const

export type ColorName = keyof typeof color
