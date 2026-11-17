import { type Hello, helloPrefixSchema, helloSchema, isCompatible, PROTOCOL_VERSION, type Refusal, type RefusalReason, type Welcome } from '@repo/protocol'

export interface AdmissionRules {
  /** The version of this core, told to the client for diagnostics. */
  coreVersion: string
  /** Whether a credential is one this core accepts. How it is checked depends on where the core runs. */
  acceptsCredential: (credential: string) => boolean
}

export type Admission = { admitted: true; hello: Hello; reply: Welcome } | { admitted: false; reply: Refusal }

/**
 * Decide whether a client may connect, from the first message it sent.
 *
 * The order matters. The protocol version is read from the part of a hello that never changes, before
 * anything else is trusted, so a client from another version is told so instead of being called malformed.
 */
export function admit(message: unknown, rules: AdmissionRules): Admission {
  const prefix = helloPrefixSchema.safeParse(message)
  if (!prefix.success) return refuse('malformed')
  if (!isCompatible(prefix.data.protocol)) return refuse('protocol')

  const hello = helloSchema.safeParse(message)
  if (!hello.success) return refuse('malformed')
  if (!rules.acceptsCredential(hello.data.credential)) return refuse('credential')

  return {
    admitted: true,
    hello: hello.data,
    reply: { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: rules.coreVersion } }
  }
}

function refuse(reason: RefusalReason): Admission {
  return { admitted: false, reply: { type: 'refusal', reason, protocol: PROTOCOL_VERSION } }
}
