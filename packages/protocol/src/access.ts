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

/** How many apps the person may let the assistant use, at most. */
export const MAX_APPS = 64

/**
 * An app the person lets the assistant see and operate (docs/SPEC.md, section 12.1, `device.screen`): known by its
 * program, as the system names it without its extension and in lower case (`notepad`, `excel`, `textedit`), and
 * shown by its name.
 */
export const appSchema = z.object({
  program: z.string().min(1).max(260),
  name: z.string().min(1).max(200)
})
export type App = z.infer<typeof appSchema>

/** The most destinations each list of the network policy holds. */
export const MAX_HOSTS = 100

/**
 * A destination on the network, as the person writes it in a list: a name, which covers the names under it
 * ("github.com" covers "api.github.com"), or an address.
 */
export const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(\*\.)?[a-z0-9.:[\]-]+$/)

/** How long a question waits for the person, in minutes, when they do not say otherwise. */
export const DEFAULT_APPROVAL_WAIT = 10
/** The longest wait the person may choose, in minutes: a day. */
export const MAX_APPROVAL_WAIT = 24 * 60

export const accessSchema = z.object({
  /** The assistant's own folder, for the files it makes. Read and write. */
  workspace: z.boolean().default(true),
  places: z.array(placeSchema).max(MAX_PLACES).default([]),
  computer: z.enum(COMPUTER_REACH).default('off'),
  approvals: z.enum(APPROVALS).default('ask'),
  /**
   * Whether what destroys (deleting, formatting, rewriting git history, changing the system) is asked at every
   * level, and never allowed for the session. Off, it follows the level like any other change: the person's choice.
   */
  askDestroying: z.boolean().default(true),
  /** Whether what publishes to others (a push, a release, a post) is asked at every level. Off, it follows the level. */
  askPublishing: z.boolean().default(true),
  /**
   * Whether a command that reaches the network is asked at every level, unless every destination it names is one
   * the person allows. Off, it follows the level, like any other command.
   */
  askNetwork: z.boolean().default(false),
  /** Whether a command that reaches a device of the local network (a private address, "nas", "printer.local") is asked at every level. */
  askLocalNetwork: z.boolean().default(true),
  /**
   * Whether a command that sends a file of this computer to another machine (an upload, a copy to a server, what
   * it is fed through a pipe) is asked at every level, unless every destination it names is one the person allows.
   */
  askSending: z.boolean().default(true),
  /** Destinations a command may reach without the network's guardrails asking: the level decides. */
  allowedHosts: z.array(hostSchema).max(MAX_HOSTS).default([]),
  /** Destinations no command may reach: refused before anyone is asked, whatever the level. */
  refusedHosts: z.array(hostSchema).max(MAX_HOSTS).default([]),
  /** How many minutes a question waits for an answer before it counts as a no. `null`: until the person answers. */
  approvalWait: z.number().int().min(1).max(MAX_APPROVAL_WAIT).nullable().default(DEFAULT_APPROVAL_WAIT),
  /** Whether the assistant may drive a web browser on the computer, in a window the person sees (docs/SPEC.md, section 12.1). */
  browser: z.boolean().default(true),
  /**
   * Whether the assistant may see and operate the other apps of the computer (docs/SPEC.md, section 12.1,
   * `device.screen`). Off by default: a desktop reaches far more than a web page.
   */
  desktop: z.boolean().default(false),
  /** The apps it may use, when it may use any: an app not listed is asked for on a card first. */
  apps: z.array(appSchema).max(MAX_APPS).default([]),
  /** Where the assistant's own folder is. Told by the core, which knows the computer it runs on; not a choice. */
  folder: z.string().optional()
})
export type Access = z.infer<typeof accessSchema>

/**
 * A fresh install: the assistant's own folder, nothing else, every change asked first, what destroys or
 * publishes always asked, a question waiting ten minutes, and its browser, but not the other apps.
 */
export const DEFAULT_ACCESS: Access = {
  workspace: true,
  places: [],
  computer: 'off',
  approvals: 'ask',
  askDestroying: true,
  askPublishing: true,
  askNetwork: false,
  askLocalNetwork: true,
  askSending: true,
  allowedHosts: [],
  refusedHosts: [],
  approvalWait: DEFAULT_APPROVAL_WAIT,
  browser: true,
  desktop: false,
  apps: []
}

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
