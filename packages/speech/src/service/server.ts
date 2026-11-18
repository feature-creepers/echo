import { bytesOf, type DownloadProgress, detectEngineThreads, detectTier, ModelDownloadError, type Tier } from '@repo/models'
import type { Recognizer, SpeechDetector, Voice } from '../ports.ts'
import { createSerial, type Serial } from '../serial.ts'
import { SpeechError, type SpeechErrorCode } from '../speech-error.ts'
import { localEngines, type SpeechEngines } from './engines.ts'
import { buffersOf, type DuplexPort, openChannel } from './port.ts'
import { CALLS, type CallName, type Input, type InstallProgress, type Output, type Reply, requestSchema, type SpeechStatus } from './protocol.ts'

/**
 * The speech service: the engines of this machine, answering requests that arrive through a port.
 *
 * It is meant for a process of its own. Loading a model takes seconds and hundreds of megabytes, and a
 * fault in native code ends the process it happens in: neither should happen in the app's main process.
 *
 * Engines are loaded the first time they are needed and kept. Each one answers one request at a time, in
 * the order they came; the recogniser and the voice do not wait for each other.
 */

export interface ServeOptions {
  /** Where model sets are installed, and downloaded to. */
  folder: string
  /** The hardware tier to work for. Left out: the one detected for this machine. */
  tier?: Tier
  /** The engines to serve. Left out: the ones that run on this machine's processor. */
  engines?: SpeechEngines
}

export interface SpeechServer {
  /** Stop answering, and let go of the engines. */
  close(): void
}

/** The client stopped waiting for a request before its turn came. Nobody reads this. */
class Cancelled extends Error {}

export function serveSpeech(port: DuplexPort, options: ServeOptions): SpeechServer {
  const tier = options.tier ?? detectTier()
  const threads = detectEngineThreads(tier)
  const engines = options.engines ?? localEngines({ folder: options.folder, threads })
  const channel = openChannel(port)

  // Each engine, once asked for. One that failed to load is asked for again next time: its set may have been installed since.
  let recognizer: Promise<Recognizer> | undefined
  let voice: Promise<Voice> | undefined
  const theRecognizer = () =>
    (recognizer ??= engines.openRecognizer().catch((error: unknown) => {
      recognizer = undefined
      throw error
    }))
  const theVoice = () =>
    (voice ??= engines.openVoice().catch((error: unknown) => {
      voice = undefined
      throw error
    }))
  const hearing = createSerial()
  const speaking = createSerial()

  /** The speech detectors the client opened, by the number it knows them by. Each hears its pieces in order. */
  const detectors = new Map<number, { detector: SpeechDetector; turn: Serial }>()
  let lastDetector = 0
  const theDetector = (number: number) => {
    const found = detectors.get(number)
    if (!found) throw new SpeechError('invalid', 'This speech detector was closed.')
    return found
  }

  /** The requests being answered, and those among them the client no longer waits for. */
  const answering = new Set<number>()
  const cancelled = new Set<number>()
  const unlessCancelled = (request: number) => {
    if (cancelled.has(request)) throw new Cancelled()
  }

  /** The download under way, if any. Every install request made meanwhile follows the same one. */
  let installing: { done: Promise<void>; stop: AbortController; followers: Set<number> } | undefined

  function status(): SpeechStatus {
    const sets = engines.sets.map((set) => ({ id: set.id, purpose: set.purpose, name: set.name, bytes: bytesOf(set), installed: engines.isInstalled(set) }))
    return { sets, ready: sets.every((set) => set.installed), tier, threads }
  }

  function install(request: number): Promise<void> {
    if (installing) {
      installing.followers.add(request)
      return installing.done
    }
    const stop = new AbortController()
    // The request is a follower before the download starts, so that it is told of the very first step.
    const followers = new Set([request])
    const done = installMissing(stop.signal, (progress) => {
      for (const follower of followers) send({ id: follower, reply: 'progress', progress })
    }).finally(() => {
      installing = undefined
    })
    installing = { done, stop, followers }
    return done
  }

  async function installMissing(signal: AbortSignal, onProgress: (progress: InstallProgress) => void): Promise<void> {
    const total = engines.sets.reduce((sum, set) => sum + bytesOf(set), 0)
    let before = 0
    for (const set of engines.sets) {
      if (!engines.isInstalled(set)) {
        const settled = before
        const report = (current: DownloadProgress) => onProgress({ received: settled + current.received, total, current })
        await engines.install(set, { signal, onProgress: report })
      }
      before += bytesOf(set)
    }
  }

  const handlers: { [Name in CallName]: (input: Input<Name>, request: number) => Promise<Output<Name>> | Output<Name> } = {
    status,
    install: (_, request) => install(request),
    'warm-up': async () => {
      await Promise.all([hearing.run(theRecognizer), speaking.run(theVoice)])
    },
    transcribe: ({ sound }, request) =>
      hearing.run(async () => {
        unlessCancelled(request)
        return (await theRecognizer()).transcribe(sound)
      }),
    speak: ({ text, how }, request) =>
      speaking.run(async () => {
        unlessCancelled(request)
        return (await theVoice()).speak(text, how)
      }),
    styles: () => engines.describeVoice().styles,
    languages: () => engines.describeVoice().languages,
    listen: async (listening) => {
      const detector = await engines.openDetector(listening)
      detectors.set(++lastDetector, { detector, turn: createSerial() })
      return { listener: lastDetector }
    },
    'listen.feed': ({ listener, sound }) => {
      const { detector, turn } = theDetector(listener)
      return turn.run(() => detector.feed(sound))
    },
    'listen.end': ({ listener }) => {
      const { detector, turn } = theDetector(listener)
      return turn.run(() => detector.end())
    },
    'listen.close': ({ listener }) => {
      detectors.get(listener)?.detector.close()
      detectors.delete(listener)
    },
    cancel: ({ request }) => {
      if (!answering.has(request)) return
      cancelled.add(request)
      // A download nobody waits for any more is stopped. What it received stays on disk for the next one.
      if (installing?.followers.delete(request) && installing.followers.size === 0) installing.stop.abort()
    }
  }

  function send(reply: Reply, buffers?: ArrayBuffer[]): void {
    channel.post(reply, buffers)
  }

  async function answer<Name extends CallName>(id: number, call: Name, input: unknown): Promise<void> {
    answering.add(id)
    try {
      const parsed = CALLS[call].input.safeParse(input)
      if (!parsed.success) throw new SpeechError('invalid', `The speech service was sent a "${call}" request it cannot read.`)
      const output = await handlers[call](parsed.data as Input<Name>, id)
      // A cancel request is never answered, and neither is a request that was cancelled: nobody waits for them.
      if (call === 'cancel' || cancelled.has(id)) return
      // The sounds in an answer were made for it, so their memory is given to the client rather than copied.
      send({ id, reply: 'done', output }, buffersOf(output))
    } catch (error) {
      if (cancelled.has(id)) return
      trace(call, error)
      send({ id, reply: 'failed', ...failure(error) })
    } finally {
      answering.delete(id)
      cancelled.delete(id)
    }
  }

  channel.receive((message) => {
    const request = requestSchema.safeParse(message)
    // Not a request at all: there is no number to answer to.
    if (request.success) void answer(request.data.id, request.data.call, request.data.input)
  })

  return {
    close() {
      channel.close()
      installing?.stop.abort()
      for (const { detector } of detectors.values()) detector.close()
      detectors.clear()
      void recognizer?.then((engine) => engine.close()).catch(() => undefined)
      void voice?.then((engine) => engine.close()).catch(() => undefined)
    }
  }
}

/**
 * The client is told what the user can act on. What went wrong underneath goes to the service's error
 * output, for whoever has to find out why: the app shows or records that output as it sees fit.
 */
function trace(call: string, error: unknown): void {
  if (error instanceof ModelDownloadError || (error instanceof Error && error.name === 'AbortError')) return
  const underneath = error instanceof SpeechError ? error.cause : error
  if (underneath === undefined) return
  process.stderr.write(`speech: "${call}" failed: ${underneath instanceof Error ? (underneath.stack ?? underneath.message) : String(underneath)}\n`)
}

/** An error as the client is told of it: a kind, and a message written for the user. */
function failure(error: unknown): { code: SpeechErrorCode; message: string } {
  if (error instanceof SpeechError) return { code: error.code, message: error.message }
  if (error instanceof ModelDownloadError) return { code: 'failed', message: error.message }
  if (error instanceof Error && error.name === 'AbortError') return { code: 'failed', message: 'The download was stopped.' }
  return { code: 'failed', message: `Speech stopped working: ${error instanceof Error ? error.message : String(error)}` }
}
