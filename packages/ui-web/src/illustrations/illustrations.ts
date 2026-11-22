import type { IllustrationName } from '@repo/catalog'
import { color } from '@repo/tokens'

/**
 * The app's own illustrations (docs/SPEC.md, section 13.1), in the eye's language: rings, lines and planes, small
 * squares, the ink with one colour that means something. Each is a drawing of vectors on a square of 96 units, sharp at
 * every size, alive by a slow movement of its own. They are written as plain SVG, so a view's block and a widget
 * app's page draw the very same picture.
 *
 * A drawing carries its own movement: transforms and an opacity only, stopped when less motion is asked for. Its ink
 * is the colour of the text around it; its accent is the persona's, where it is drawn.
 */

const INK = 'currentColor'
const YELLOW = color.warn
const BLUE = color.info
/** The accent where the drawing stands: the window's, or the one a widget app's page is given. */
const ACCENT = 'var(--accent, var(--echo-accent))'
/** What covers a line that passes behind a plane: the ground the drawing stands on. */
const GROUND = `var(--color-ground, var(--echo-ground, ${color.ground}))`

const line = `fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="square"`

/** A cloud's outline, flat under two bumps, its left end at `x`, its base at `y`. */
const cloud = (x: number, y: number, more = '') => `<path d="M${x} ${y}h50a13 13 0 0 0 0-26a19 19 0 0 0-36-5a16 16 0 0 0-14 31z" ${line} ${more}/>`

/** What falls from a cloud: marks set side by side under it, each starting a little after the one before. */
const falling = (mark: (x: number) => string, xs: readonly number[], move: string, seconds: number) =>
  xs.map((x, at) => `<g class="${move}" style="animation-delay:${((-at * seconds) / xs.length).toFixed(2)}s">${mark(x)}</g>`).join('')

/** Hatching over a box: lines leaning right, a step apart, to be cut to a shape. */
const hatch = (left: number, top: number, right: number, bottom: number, step: number) => {
  const lines: string[] = []
  for (let x = left - (bottom - top); x < right; x += step) lines.push(`M${x} ${bottom}L${x + (bottom - top)} ${top}`)
  return lines.join('')
}

/** The rays of a sun round a centre, from one radius to another. */
const rays = (cx: number, cy: number, from: number, to: number, count = 8) =>
  Array.from({ length: count }, (_, at) => {
    const angle = (at * 2 * Math.PI) / count
    const [x, y] = [Math.cos(angle), Math.sin(angle)]
    const point = (radius: number) => `${(cx + x * radius).toFixed(1)} ${(cy + y * radius).toFixed(1)}`
    return `M${point(from)}L${point(to)}`
  }).join('')

const DRAWN: Record<IllustrationName, string> = {
  sun: `<g class="turn"><path d="${rays(48, 48, 33, 41)}" ${line}/></g><circle cx="48" cy="48" r="25" ${line}/><circle cx="48" cy="48" r="14" fill="${YELLOW}"/>`,
  moon:
    `<circle cx="46" cy="50" r="27" ${line}/><path d="M46 32a18 18 0 1 0 18 18a14 14 0 0 1-18-18z" fill="${INK}"/>` +
    `<rect class="blink" x="74" y="14" width="6" height="6" fill="${YELLOW}"/><rect class="blink late" x="84" y="32" width="4" height="4" fill="${INK}"/>`,
  'partly-cloudy':
    `<g class="turn" style="transform-origin:34px 34px"><path d="${rays(34, 34, 21, 27)}" ${line}/></g><circle cx="34" cy="34" r="15" ${line}/><circle cx="34" cy="34" r="8" fill="${YELLOW}"/>` +
    `<g class="drift">${cloud(30, 76, `fill="${GROUND}"`)}</g>`,
  // Overcast: the cloud's lower part hatched, as the eye's half is.
  cloud:
    `<clipPath id="echo-il-overcast"><path d="M20 66h50a13 13 0 0 0 0-26a19 19 0 0 0-36-5a16 16 0 0 0-14 31z"/></clipPath>` +
    `<g class="drift"><path d="${hatch(4, 52, 84, 68, 6)}" fill="none" stroke="${INK}" stroke-width="1.5" clip-path="url(#echo-il-overcast)"/>${cloud(20, 66)}</g>`,
  rain: `${cloud(20, 54)}${falling((x) => `<path d="M${x} 62l-5 12" fill="none" stroke="${BLUE}" stroke-width="3" stroke-linecap="square"/>`, [34, 46, 58, 70], 'fall', 1.4)}`,
  snow: `${cloud(20, 54)}${falling((x) => `<rect x="${x - 2.5}" y="62" width="5" height="5" fill="${INK}"/>`, [30, 42, 54, 66], 'fall slow', 3.2)}`,
  storm: `${cloud(20, 54)}<path class="flash" d="M52 58l-14 17h11l-5 15l18-21h-11l7-11z" fill="${YELLOW}"/>`,
  fog: `<g ${line}><path class="slide" d="M16 30h52"/><path class="slide back" d="M28 44h52"/><path class="slide" d="M16 58h64"/><path class="slide back" d="M28 72h40" opacity=".5"/></g>`,
  wind:
    `<g ${line}><path class="slide" d="M12 36h44a9 9 0 1 0-9-9"/><path class="slide back" d="M12 50h62a9 9 0 1 1-9 9"/><path class="slide" d="M12 64h30" opacity=".5"/></g>` +
    `<rect class="slide" x="78" y="33" width="5" height="5" fill="${ACCENT}"/>`
}

/** How each part moves. Every drawing carries these few rules: the same ones, so several on a page agree. */
const MOVES = [
  '.echo-il *{transform-box:fill-box;transform-origin:center}',
  '.echo-il .turn{transform-box:view-box;transform-origin:48px 48px;animation:echo-il-turn 28s linear infinite}',
  '.echo-il .drift{animation:echo-il-drift 7s ease-in-out infinite alternate}',
  '.echo-il .fall{animation:echo-il-fall 1.4s linear infinite}',
  '.echo-il .fall.slow{animation-duration:3.2s}',
  '.echo-il .flash{animation:echo-il-flash 3.6s steps(1,end) infinite}',
  '.echo-il .blink{animation:echo-il-blink 4s ease-in-out infinite}',
  '.echo-il .blink.late{animation-delay:-2s}',
  '.echo-il .slide{animation:echo-il-slide 5s ease-in-out infinite alternate}',
  '.echo-il .slide.back{animation-direction:alternate-reverse}',
  '@keyframes echo-il-turn{to{transform:rotate(360deg)}}',
  '@keyframes echo-il-drift{from{transform:translateX(-3px)}to{transform:translateX(3px)}}',
  '@keyframes echo-il-fall{0%{transform:translateY(-4px);opacity:0}25%{opacity:1}75%{opacity:1}100%{transform:translateY(14px);opacity:0}}',
  '@keyframes echo-il-flash{0%{opacity:.3}44%{opacity:1}48%{opacity:.3}52%{opacity:1}60%{opacity:.3}}',
  '@keyframes echo-il-blink{0%,100%{opacity:1}50%{opacity:.25}}',
  '@keyframes echo-il-slide{from{transform:translateX(-4px)}to{transform:translateX(4px)}}',
  '@media (prefers-reduced-motion:reduce){.echo-il *{animation:none!important}}'
].join('')

/** A drawing as SVG: it takes the width it is given and the colour of the text around it. */
const svg = (name: IllustrationName, rules: string) =>
  `<svg class="echo-il" viewBox="0 0 96 96" fill="none" aria-hidden="true" style="display:block;width:100%;height:auto;overflow:visible">${rules}${DRAWN[name]}</svg>`

/** An illustration as SVG, whole, with how it moves: for a place that has no rule of its own for it. */
export const illustration = (name: IllustrationName): string => svg(name, `<style>${MOVES}</style>`)

/**
 * The illustrations for a page that draws them itself, a widget app's: how they move, as rules the page carries once,
 * and each drawing by its name, without them.
 */
export const PAGE_ILLUSTRATIONS: { rules: string; drawn: Readonly<Record<IllustrationName, string>> } = {
  rules: MOVES,
  drawn: Object.fromEntries((Object.keys(DRAWN) as IllustrationName[]).map((name) => [name, svg(name, '')])) as Record<IllustrationName, string>
}
