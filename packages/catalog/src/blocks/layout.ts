import { z } from 'zod'
import type { Block } from '../block.ts'

const gap = z.enum(['tight', 'normal', 'loose']).default('normal')

export const layoutBlocks = {
  Stack: {
    description: 'Puts its children one under the other. The usual root of a view.',
    props: z.object({ gap, align: z.enum(['start', 'center', 'end', 'stretch']).default('stretch') }),
    children: true
  },
  Row: {
    description: 'Puts its children side by side. Use it for a figure next to its label, or a few things of equal weight.',
    props: z.object({
      gap,
      align: z.enum(['start', 'center', 'end', 'baseline']).default('center'),
      justify: z.enum(['start', 'center', 'end', 'between']).default('start'),
      wrap: z.boolean().default(false)
    }),
    children: true
  },
  Grid: {
    description: 'Lays its children out as tiles of equal width, as many per row as `columns` says, fewer when the window is narrow.',
    props: z.object({ columns: z.number().int().min(1).max(6).default(3), gap }),
    children: true
  },
  Card: {
    description: 'A panel that groups what belongs together, with an optional title above its content. Do not put a Card directly inside a Card.',
    props: z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      /** `accent` marks the one card that matters most. */
      emphasis: z.enum(['plain', 'accent']).default('plain')
    }),
    children: true
  },
  Section: {
    description: 'A titled part of a longer view, with a small heading in capitals and its content under it.',
    props: z.object({ title: z.string(), description: z.string().optional() }),
    children: true
  },
  Divider: {
    description: 'A thin line between two parts.',
    props: z.object({}),
    children: false
  }
} satisfies Record<string, Block>
