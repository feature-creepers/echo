/**
 * The colours of the interface: a warm black ground, flat layers that barely rise from it, a cream ink in three
 * weights, hairlines of that ink, and three flat colours kept for what they mean.
 */
export const color = {
  /** Behind everything: the page, the darkest. */
  ground: '#090908',
  /** The side panel: a sheet laid beside the page, a shade above it. */
  panel: '#0f0f0d',
  /** A plane resting on the ground: the composer, a field. */
  surface: '#141412',
  /** Something resting on a plane: a row under the pointer. */
  raised: '#191916',
  /** A hairline between two areas. A wash of the ink, so it reads on every layer. */
  line: 'rgb(235 230 218 / 0.16)',
  /** The dots under the home of the main screen: one pixel each, and barely there. */
  dot: 'rgb(235 230 218 / 0.13)',
  /** The edge of something that can be typed in or pressed, and the rule over an earlier answer. */
  lineStrong: 'rgb(235 230 218 / 0.34)',
  /** The ink: sentences, figures, rules, marks, and washes of it at a low opacity (`bg-text/[0.06]`). */
  text: '#ebe6da',
  /** Secondary sentences. */
  textSoft: '#a09b8e',
  /** Labels and hints: the dimmest text that still reads on every layer. */
  textFaint: '#8a8578',
  /** Something is wrong and needs attention. */
  danger: '#f0603c',
  /** Something went through. It is said in the ink: colour is kept for what needs the eye. */
  ok: '#ebe6da',
  /** Something to keep an eye on. */
  warn: '#e9b10a',
  /** Something to tell apart that is neither wrong nor to watch: water, cold, a second series, a line added. */
  info: '#6b85f5',
  /** For shadows and scrims made of it at a low opacity. Never used whole. */
  black: '#000000'
} as const

/**
 * The colours of code in a diff, by what each word is to its language. Quiet hues of their own, used nowhere
 * else: none is the info or danger of the lines added and removed, nor an accent, so code reads over either tint
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
