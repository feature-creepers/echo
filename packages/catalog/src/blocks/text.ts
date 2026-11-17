import { z } from 'zod'
import { type Block, TONES } from '../block.ts'

const tone = z.enum(TONES).default('normal')

export const textBlocks = {
  Heading: {
    description: 'A title. Level 1 once at most, for the subject of the view; 2 and 3 for parts of it.',
    props: z.object({ text: z.string(), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }),
    children: false
  },
  Text: {
    description: 'A sentence or a short paragraph.',
    props: z.object({
      text: z.string(),
      tone,
      size: z.enum(['small', 'normal', 'large']).default('normal'),
      weight: z.enum(['normal', 'medium']).default('normal')
    }),
    children: false
  },
  Badge: {
    description: 'A word or two that labels a state or a category.',
    props: z.object({ text: z.string(), tone }),
    children: false
  },
  KeyValue: {
    description: 'Facts as pairs: a label and its value, one per line. For properties of one thing.',
    props: z.object({ items: z.array(z.object({ label: z.string(), value: z.string() })).min(1) }),
    children: false
  },
  List: {
    description: 'Several items of the same kind. `check` marks them as things done or to do.',
    props: z.object({
      items: z.array(z.object({ text: z.string(), detail: z.string().optional(), checked: z.boolean().optional() })).min(1),
      marker: z.enum(['bullet', 'number', 'check', 'none']).default('bullet')
    }),
    children: false
  },
  Steps: {
    description: 'Things to do in order, each with a title and an optional explanation. `state` shows where the user stands.',
    props: z.object({
      items: z.array(z.object({ title: z.string(), detail: z.string().optional(), state: z.enum(['done', 'current', 'todo']).default('todo') })).min(1)
    }),
    children: false
  },
  Prose: {
    description:
      'Long formatted text, written in Markdown (paragraphs, emphasis, lists, headings). Only when the user asked for detail or a document to read; otherwise compose with the other blocks.',
    props: z.object({ markdown: z.string() }),
    children: false
  }
} satisfies Record<string, Block>
