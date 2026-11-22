import { z } from 'zod'
import { type Block, TONES } from '../block.ts'

/** The colours a shape may take: the ones of the app, or none. */
const paint = z.enum([...TONES, 'none'])

const stroke = { stroke: paint.default('normal'), strokeWidth: z.number().min(0).max(24).default(1.5), opacity: z.number().min(0).max(1).default(1) }
const fill = { fill: paint.default('none') }

/** One shape of a drawing, in the drawing's own coordinates. */
const shapeSchema = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('line'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), ...stroke, dashed: z.boolean().default(false) }),
  z.object({ shape: z.literal('circle'), cx: z.number(), cy: z.number(), r: z.number().min(0), ...stroke, ...fill }),
  z.object({
    shape: z.literal('rect'),
    x: z.number(),
    y: z.number(),
    width: z.number().min(0),
    height: z.number().min(0),
    radius: z.number().min(0).default(0),
    ...stroke,
    ...fill
  }),
  z.object({ shape: z.literal('polyline'), points: z.array(z.tuple([z.number(), z.number()])).min(2), closed: z.boolean().default(false), ...stroke, ...fill }),
  /** An SVG path, for curves. Only path commands and numbers. */
  z.object({ shape: z.literal('path'), d: z.string().regex(/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.+-]+$/), ...stroke, ...fill }),
  z.object({
    shape: z.literal('text'),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    size: z.number().min(4).max(96).default(12),
    anchor: z.enum(['start', 'middle', 'end']).default('start'),
    tone: z.enum(TONES).default('normal')
  })
])
export type Shape = z.infer<typeof shapeSchema>

/**
 * The illustrations the app draws itself, by name (docs/SPEC.md, section 13.1): the sky first. A renderer has a
 * drawing for each one.
 */
export const ILLUSTRATIONS = ['sun', 'moon', 'partly-cloudy', 'cloud', 'rain', 'snow', 'storm', 'fog', 'wind'] as const
export type IllustrationName = (typeof ILLUSTRATIONS)[number]

export const drawingBlocks = {
  Illustration: {
    description:
      "A ready-made picture in the app's own style, alive, by name: the sky of a forecast beside its figures, as a card's main picture or small in a row. Use it whenever it has the picture; for any other, draw a Drawing.",
    props: z.object({
      name: z.enum(ILLUSTRATIONS),
      /** How large it is shown: `icon` beside a Metric or in a row, `figure` as a card's picture, `large` alone. */
      size: z.enum(['icon', 'figure', 'large']).default('figure'),
      /** What it shows, in words, for someone who cannot see it. Left out, its name. */
      label: z.string().optional()
    }),
    children: false
  },
  Drawing: {
    description:
      'A picture you draw yourself from simple shapes, in a canvas `width` by `height` units with the origin at the top left. Use it for a pictogram, a diagram, a map sketch, anything no other block shows, a picture Illustration has no name for. Keep pictograms simple and bold: a few shapes, `accent` for what matters.',
    props: z.object({
      width: z.number().min(1).max(2000),
      height: z.number().min(1).max(2000),
      /** How large it is shown. `icon` sits in a line of text or beside a Metric; `figure` is a picture among the content; `wide` takes the width. */
      size: z.enum(['icon', 'figure', 'wide']).default('figure'),
      shapes: z.array(shapeSchema).min(1).max(400),
      /** What the picture shows, in words, for someone who cannot see it. */
      label: z.string()
    }),
    children: false
  },
  Image: {
    description:
      'A picture from a web address (https only), with a description of what it shows. Use it only for a real picture you were given or found, never as decoration.',
    props: z.object({ url: z.string().regex(/^https:\/\//), alt: z.string(), caption: z.string().optional() }),
    children: false
  }
} satisfies Record<string, Block>
