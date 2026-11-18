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

/**
 * How much the assistant does without asking, within what it was granted. Reading, and commands that only read,
 * never ask. `ask`: every change to a file and every other command is asked. `trust`: changes to files are made,
 * other commands are asked. `auto`: nothing is asked but what destroys, which always is.
 */
export const APPROVALS = ['ask', 'trust', 'auto'] as const

export const MAX_PLACES = 64

export const accessSchema = z.object({
  /** The assistant's own folder, for the files it makes. Read and write. */
  workspace: z.boolean().default(true),
  places: z.array(placeSchema).max(MAX_PLACES).default([]),
  computer: z.enum(COMPUTER_REACH).default('off'),
  approvals: z.enum(APPROVALS).default('ask'),
  /** Whether the assistant may drive a web browser on the computer, in a window the person sees (docs/SPEC.md, section 12.1). */
  browser: z.boolean().default(true),
  /** Where the assistant's own folder is. Told by the core, which knows the computer it runs on; not a choice. */
  folder: z.string().optional()
})
export type Access = z.infer<typeof accessSchema>

/** A fresh install: the assistant's own folder, nothing else, every change asked first, and its browser. */
export const DEFAULT_ACCESS: Access = { workspace: true, places: [], computer: 'off', approvals: 'ask', browser: true }

/**
 * A yes that lasts until the app quits, the access changes, or the person stops everything: for a command, the
 * same program and subcommand (`git commit`); for a change, any change in the same folder. A command that
 * destroys is never covered.
 */
export const allowanceSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['command', 'change']),
  /** The program and subcommand, or the folder, as the person reads it. */
  subject: z.string().min(1).max(4096),
  /** When it was given: an ISO 8601 date. */
  at: z.string()
})
export type Allowance = z.infer<typeof allowanceSchema>

/** A place the assistant never reaches, whatever was granted: keys, credentials, browser profiles, password stores. */
export const protectedPlaceSchema = z.object({
  /** What it holds, in a few words: "SSH keys". */
  label: z.string(),
  /** Where it is on this computer, or the files it is (`*.kdbx`). */
  path: z.string()
})
export type ProtectedPlace = z.infer<typeof protectedPlaceSchema>
