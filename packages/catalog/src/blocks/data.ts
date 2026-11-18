import { z } from 'zod'
import { type Block, TONES } from '../block.ts'
import { feedSchema, seriesFeedSchema } from '../feed.ts'

const tone = z.enum(TONES).default('normal')
const cell = z.union([z.string(), z.number()])

export const dataBlocks = {
  Metric: {
    description: 'One figure that matters, large, with its label. Put several in a Grid or a Row to compare them.',
    props: z.object({
      label: z.string(),
      value: z.string(),
      unit: z.string().optional(),
      /** A few words under the figure: what it compares to, or when it was measured. */
      detail: z.string().optional(),
      trend: z.enum(['up', 'down', 'flat']).optional(),
      tone,
      feed: feedSchema.optional()
    }),
    children: false
  },
  Table: {
    description: 'Rows and columns, for things that share the same properties. Keep it to what is asked: few columns, the rows that matter.',
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string(), align: z.enum(['start', 'end']).default('start') })).min(1),
      rows: z.array(z.record(z.string(), cell))
    }),
    children: false
  },
  Chart: {
    description:
      'A drawn series of numbers: `line` or `area` for something that changes over time, `bar` to compare amounts. One to three series. `x` values are labels in order.',
    props: z.object({
      kind: z.enum(['line', 'area', 'bar']),
      series: z
        .array(z.object({ name: z.string(), points: z.array(z.object({ x: z.string(), y: z.number() })).min(1), tone, feed: seriesFeedSchema.optional() }))
        .min(1)
        .max(3),
      /** The unit of the values, shown on the axis: '°C', '€', '%'. */
      unit: z.string().optional(),
      height: z.enum(['short', 'normal', 'tall']).default('normal')
    }),
    children: false
  },
  Timeline: {
    description: 'Moments in order, each with when it is and what happens. For a schedule, a history, a plan over time.',
    props: z.object({ items: z.array(z.object({ time: z.string(), title: z.string(), detail: z.string().optional(), tone })).min(1) }),
    children: false
  },
  Progress: {
    description: 'How far along something is, from 0 to 1, as a bar.',
    props: z.object({
      value: z.number().min(0).max(1),
      feed: feedSchema.optional(),
      label: z.string().optional(),
      detail: z.string().optional(),
      tone: z.enum(TONES).default('accent')
    }),
    children: false
  }
} satisfies Record<string, Block>
