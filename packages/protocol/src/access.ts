import { z } from 'zod'

/**
 * What the assistant may reach on the computer its core runs on (docs/SPEC.md, section 12.2). The user grants
 * it; the core and the harness enforce it on every use, whatever the model asks.
 */

/** A folder or a file the user granted, read only or read and write. Its path is absolute, as the system names it. */
export const placeSchema = z.object({
  path: z.string().min(1).max(4096),
  kind: z.enum(['folder', 'file']),
  write: z.boolean()
})
export type Place = z.infer<typeof placeSchema>

/** Beyond the places granted: nothing more, reading anywhere, or reading and changing anywhere. */
export const COMPUTER_REACH = ['off', 'read', 'write'] as const

/** Whether the user approves each change and command (`ask`), or lets the assistant act within what it was granted (`trust`). */
export const APPROVALS = ['ask', 'trust'] as const

export const MAX_PLACES = 64

export const accessSchema = z.object({
  /** The assistant's own folder, for the files it makes. Read and write. */
  workspace: z.boolean().default(true),
  places: z.array(placeSchema).max(MAX_PLACES).default([]),
  computer: z.enum(COMPUTER_REACH).default('off'),
  approvals: z.enum(APPROVALS).default('ask'),
  /** Where the assistant's own folder is. Told by the core, which knows the computer it runs on; not a choice. */
  folder: z.string().optional()
})
export type Access = z.infer<typeof accessSchema>

/** A fresh install: the assistant's own folder, nothing else, and every change asked first. */
export const DEFAULT_ACCESS: Access = { workspace: true, places: [], computer: 'off', approvals: 'ask' }
