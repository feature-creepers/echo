import type { Heard, Hearing, Listening, Sound, Speaking, SpeechDetector, VoiceStyle } from '../ports.ts'
import { SpeechError } from '../speech-error.ts'
import { type DuplexPort, openChannel } from './port.ts'
import { CALLS, type CallName, type Input, type InstallProgress, type Output, replySchema, type SpeechStatus } from './protocol.ts'

/**
 * The speech service as the app sees it: every call is a message to the process that runs the engines,
 * and resolves with its answer. A failure comes back as a `SpeechError` whose message is written for the user.
 */

export interface Waiting {
  /** Stops waiting. A request whose turn has not come is dropped; a download is stopped and continues next time. */
  signal?: AbortSignal
}

export interface SpeechService {
  /** Which model sets are installed, and the hardware tier the service works for. */
  status(): Promise<SpeechStatus>
  /** Download the sets that are missing. Resolves at once when there are none. */
  install(onProgress?: (progress: InstallProgress) => void, waiting?: Waiting): Promise<void>
  /** Load the recogniser and the voice now, so that the first sentence does not wait for them. */
  warmUp(): Promise<void>
  /** Turn one utterance into text, favouring the person's own words when given. The sound given is left as it is. */
  transcribe(sound: Sound, how?: Hearing, waiting?: Waiting): Promise<Heard>
  /** Speak one sentence and resolve with its sound. */
  speak(text: string, how: Speaking, waiting?: Waiting): Promise<Sound>
  /** The styles the voice can speak in. Known before anything is downloaded. */
  styles(): Promise<VoiceStyle[]>
  /** The languages the voice speaks, as two-letter codes. Known before anything is downloaded. */
  languages(): Promise<string[]>
  /** Open a speech detector, to feed with the microphone's sound as it comes. */
  listen(listening?: Listening): Promise<SpeechDetector>
  /** Stop using the port. Requests still waiting are rejected. */
  close(): void
}

/** What goes with a call beside its input. */
interface Sending {
  /** Sounds inside the input that were copied for this call: their memory is given to the service. */
  sounds?: Float32Array[]
  signal?: AbortSignal | undefined
  onProgress?: ((progress: InstallProgress) => void) | undefined
}

/** A call whose answer has not come yet. */
interface Pending {
  call: CallName
  resolve(output: unknown): void
  reject(error: unknown): void
  onProgress: ((progress: InstallProgress) => void) | undefined
}

export function connectSpeech(port: DuplexPort): SpeechService {
  const channel = openChannel(port)
  const pending = new Map<number, Pending>()
  let lastRequest = 0
  let stopped: SpeechError | undefined

  function stop(reason: string): void {
    stopped ??= new SpeechError('failed', reason)
    for (const waiting of pending.values()) waiting.reject(stopped)
    pending.clear()
  }

  channel.receive((message) => {
    const parsed = replySchema.safeParse(message)
    if (!parsed.success) return
    const reply = parsed.data
    const waiting = pending.get(reply.id)
    if (!waiting) return // Cancelled since, or never asked.

    if (reply.reply === 'progress') {
      waiting.onProgress?.(reply.progress)
      return
    }
    pending.delete(reply.id)
    if (reply.reply === 'failed') {
      waiting.reject(new SpeechError(reply.code, reply.message))
      return
    }
    const output = CALLS[waiting.call].output.safeParse(reply.output)
    if (output.success) waiting.resolve(output.data)
    else waiting.reject(new SpeechError('failed', `The speech service answered "${waiting.call}" with something unexpected.`))
  })
  channel.gone(() => stop('The speech service stopped.'))

  /** Make a call and wait for its answer. */
  function call<Name extends CallName>(name: Name, input: Input<Name>, { sounds = [], signal, onProgress }: Sending = {}): Promise<Output<Name>> {
    return new Promise<Output<Name>>((resolve, reject) => {
      if (stopped) return reject(stopped)
      if (signal?.aborted) return reject(signal.reason)

      const id = ++lastRequest
      const forget = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => {
        if (!pending.delete(id)) return
        channel.post({ id: ++lastRequest, call: 'cancel', input: { request: id } satisfies Input<'cancel'> })
        reject(signal?.reason)
      }
      pending.set(id, {
        call: name,
        resolve: (output) => {
          forget()
          resolve(output as Output<Name>)
        },
        reject: (error) => {
          forget()
          reject(error)
        },
        onProgress
      })
      signal?.addEventListener('abort', onAbort, { once: true })

      try {
        channel.post(
          { id, call: name, input },
          sounds.flatMap((samples) => (samples.buffer instanceof ArrayBuffer ? [samples.buffer] : []))
        )
      } catch (error) {
        pending.delete(id)
        forget()
        reject(new SpeechError('failed', 'The speech service could not be reached.', { cause: error }))
      }
    })
  }

  /**
   * A sound ready to send. Where the port moves memory, it is a copy to give away, so that the caller
   * keeps its sound; where the port copies anyway, it is the sound itself.
   */
  function outgoing(sound: Sound): { sound: Sound; sounds: Float32Array[] } {
    if (!channel.moves) return { sound, sounds: [] }
    const samples = sound.samples.slice()
    return { sound: { sampleRate: sound.sampleRate, samples }, sounds: [samples] }
  }

  return {
    status: () => call('status', {}),
    install: async (onProgress, waiting) => {
      await call('install', {}, { signal: waiting?.signal, onProgress })
    },
    warmUp: async () => {
      await call('warm-up', {})
    },
    transcribe: (sound, how = {}, waiting) => {
      const { sound: sent, sounds } = outgoing(sound)
      const words = how.words === undefined || how.words.length === 0 ? {} : { words: [...how.words] }
      return call('transcribe', { sound: sent, ...words }, { sounds, signal: waiting?.signal })
    },
    speak: (text, how, waiting) => call('speak', { text, how }, { signal: waiting?.signal }),
    styles: () => call('styles', {}),
    languages: () => call('languages', {}),
    listen: async (listening = {}) => {
      const { listener } = await call('listen', listening)
      return {
        feed: (sound) => {
          const { sound: sent, sounds } = outgoing(sound)
          return call('listen.feed', { listener, sound: sent }, { sounds })
        },
        end: () => call('listen.end', { listener }),
        close: () => {
          // Nothing to wait for, and nothing to say if the service is already gone.
          call('listen.close', { listener }).catch(() => undefined)
        }
      }
    },
    close: () => {
      stop('The connection to the speech service was closed.')
      channel.close()
    }
  }
}
