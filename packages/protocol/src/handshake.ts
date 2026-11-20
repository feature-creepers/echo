import { z } from 'zod'
import { capabilitySchema } from './capabilities.ts'

/**
 * The handshake: the first exchange on every connection, local or remote.
 *
 * The client says hello; the core answers with a welcome or a refusal. Nothing else is accepted before it.
 */

const CLIENT_KINDS = ['desktop', 'mobile'] as const

/**
 * The part of a hello that never changes, whatever the protocol version. A core reads it first, so it can
 * refuse a client that is too old or too new by name, instead of failing to understand it.
 */
export const helloPrefixSchema = z.object({
  type: z.literal('hello'),
  protocol: z.number().int().positive()
})

export const helloSchema = helloPrefixSchema.extend({
  client: z.object({
    kind: z.enum(CLIENT_KINDS),
    /** The version of the app, for diagnostics. */
    version: z.string().min(1),
    /** Identifies this device across connections. */
    device: z.string().min(1)
  }),
  capabilities: z.array(capabilitySchema),
  /** What proves the client may connect: a token for a local core, an account credential for a remote one. */
  credential: z.string().min(1)
})
export type Hello = z.infer<typeof helloSchema>

const welcomeSchema = z.object({
  type: z.literal('welcome'),
  protocol: z.number().int().positive(),
  core: z.object({ version: z.string().min(1) })
})
export type Welcome = z.infer<typeof welcomeSchema>

const REFUSAL_REASONS = [
  /** The message was not a hello this core could read. */
  'malformed',
  /** Client and core speak different protocol versions. */
  'protocol',
  /** The credential was not accepted. */
  'credential'
] as const

const refusalSchema = z.object({
  type: z.literal('refusal'),
  reason: z.enum(REFUSAL_REASONS),
  /** The core's protocol version, so the client can say which side needs updating. */
  protocol: z.number().int().positive()
})
export type Refusal = z.infer<typeof refusalSchema>
export type RefusalReason = Refusal['reason']

/** What a core answers to a hello. */
export const handshakeReplySchema = z.discriminatedUnion('type', [welcomeSchema, refusalSchema])
