import { z } from 'zod'
import type { Block } from '../block.ts'

/** Files on the computer: what the person can open, find in its folder, or look at without leaving the app. */
export const fileBlocks = {
  FileList: {
    description:
      'Files on the computer, by absolute path, each with its size and buttons to open it, show it in its folder or preview it. Past `limit` the rest fold away.',
    props: z.object({
      files: z
        .array(
          z.object({
            path: z.string().min(1).max(4096),
            name: z.string().optional(),
            size: z.number().int().nonnegative().optional(),
            /** A few words under its name: where it is, what it holds. */
            detail: z.string().optional()
          })
        )
        .min(1)
        .max(200),
      limit: z.number().int().min(1).max(50).default(5)
    }),
    children: false
  }
} satisfies Record<string, Block>
