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
  /** The dots of the window's ground: dense, one pixel each, and barely there. */
  dot: 'rgb(255 255 255 / 0.1)',
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
  warn: '#f0c05a',
  /**
   * Pure white and black, for washes and shadows made of them at a low opacity (`bg-white/[0.06]`): a raised
   * control, a selected row, the dark edge under the title row. Never used whole.
   */
  white: '#ffffff',
  black: '#000000'
} as const

/**
 * The colours of code in a diff, by what each word is to its language. Quiet hues of their own, used nowhere
 * else: none is the ok or danger of the lines added and removed, nor an accent, so code reads over either tint
 * and never takes a state's meaning. Comments are the faint text.
 */
export const code = {
  keyword: '#c8a2f8',
  string: '#a5d6ff',
  /** Numbers and constants: `42`, `true`, `null`, `MAX_SIZE`. */
  number: '#f4b183',
  /** Types and classes, and the names that give a text its structure: keys, attributes, variables. */
  type: '#7ed6c8',
  function: '#e0d9a6'
} as const
