import { z } from 'zod'
import { MAX_WORD_LENGTH, MAX_WORDS } from '../recognizers/words.ts'

/**
 * What the speech service and its client say to each other. The service runs in a process of its own, so
 * everything crosses as messages, and each side checks what it receives against these descriptions.
 *
 * A request names a call and carries its input; the service answers with the call's output, or says why it
 * failed. Sound crosses as the typed array it is, never as a list of numbers: the port copies or moves the
 * bytes underneath.
 */

/** Samples, whatever memory they sit on: the same type as in the ports. */
const samples = z.custom<Float32Array>((value) => value instanceof Float32Array)
const sound = z.object({ sampleRate: z.number().int().positive(), samples })

const speechEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), at: z.number() }),
  z.object({ type: z.literal('ended'), start: z.number(), end: z.number(), speech: sound })
])

/** One model set speech needs, and whether it is on this device. */
const setStatus = z.object({
  id: z.string(),
  purpose: z.enum(['recognition', 'voice', 'speech-detection']),
  name: z.string(),
  /** The size of its download. */
  bytes: z.number(),
  installed: z.boolean()
})

const status = z.object({
  sets: z.array(setStatus),
  /** Every set is installed: speech can be used. */
  ready: z.boolean(),
  /** The hardware tier the service works for. */
  tier: z.enum(['light', 'standard', 'performance']),
  /** How many processor threads its engines use. */
  threads: z.number().int().positive()
})

/** How far the download of everything speech needs has got. */
const installProgress = z.object({
  /** Bytes on disk so far, over every set, those installed before included. */
  received: z.number(),
  total: z.number(),
  /** The set being downloaded now, and how far that one has got. */
  current: z.object({ set: z.string(), received: z.number(), total: z.number() })
})

const nothing = z.object({})
const listener = z.object({ listener: z.number().int() })

/** Every call the service answers: what it takes and what it gives back. */
export const CALLS = {
  status: { input: nothing, output: status },
  /** Download the sets that are missing. Progress is sent while it runs. */
  install: { input: nothing, output: z.void() },
  /** Load the recogniser and the voice now, so that the first sentence does not wait for them. */
  'warm-up': { input: nothing, output: z.void() },
  transcribe: {
    input: z.object({ sound, words: z.array(z.string().max(MAX_WORD_LENGTH)).max(MAX_WORDS).exactOptional() }),
    output: z.object({ text: z.string(), language: z.string().exactOptional() })
  },
  speak: {
    input: z.object({ text: z.string(), how: z.object({ style: z.string(), language: z.string(), speed: z.number().exactOptional() }) }),
    output: sound
  },
  styles: { input: nothing, output: z.array(z.object({ id: z.string(), name: z.string() })) },
  languages: { input: nothing, output: z.array(z.string()) },
  /** Open a speech detector. It is then fed, ended and closed by the number this returns. */
  listen: { input: z.object({ silence: z.number().exactOptional() }), output: listener },
  'listen.feed': { input: listener.extend({ sound }), output: z.array(speechEvent) },
  'listen.end': { input: listener, output: z.array(speechEvent) },
  'listen.close': { input: listener, output: z.void() },
  /** The client no longer waits for the request with this number. It gets no answer; nor does this call need one. */
  cancel: { input: z.object({ request: z.number().int() }), output: z.void() }
} as const

export type CallName = keyof typeof CALLS
export type Input<Name extends CallName> = z.infer<(typeof CALLS)[Name]['input']>
export type Output<Name extends CallName> = z.infer<(typeof CALLS)[Name]['output']>

export type SpeechStatus = z.infer<typeof status>
export type InstallProgress = z.infer<typeof installProgress>

const id = z.number().int()

/** Client to service. The input is checked against the call it names once that is known. */
export const requestSchema = z.object({ id, call: z.enum(Object.keys(CALLS) as [CallName, ...CallName[]]), input: z.unknown() })
export type Request = z.infer<typeof requestSchema>

/** Service to client, about the request with the same number. */
export const replySchema = z.discriminatedUnion('reply', [
  z.object({ id, reply: z.literal('progress'), progress: installProgress }),
  z.object({ id, reply: z.literal('done'), output: z.unknown() }),
  z.object({ id, reply: z.literal('failed'), code: z.enum(['not-installed', 'unavailable', 'invalid', 'failed']), message: z.string() })
])
export type Reply = z.infer<typeof replySchema>
