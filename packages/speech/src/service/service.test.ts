import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { type DownloadProgress, type InstallOptions, ModelDownloadError, type ModelSet } from '@repo/models'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Listening, Sound, Speaking, SpeechEvent } from '../ports.ts'
import { SpeechError } from '../speech-error.ts'
import { connectSpeech, type SpeechService } from './client.ts'
import type { SpeechEngines } from './engines.ts'
import type { DuplexPort } from './port.ts'
import type { InstallProgress } from './protocol.ts'
import { type SpeechServer, serveSpeech } from './server.ts'

/**
 * The service and its client, joined by a real message channel, with engines that need no model:
 * what is tested here is everything between the app and the engines.
 */

function set(id: string, purpose: ModelSet['purpose'], bytes: number): ModelSet {
  return {
    id,
    purpose,
    name: `the ${purpose} set`,
    licence: 'MIT',
    files: [{ path: 'model.bin', url: 'https://models.invalid/model.bin', bytes, sha256: '0'.repeat(64) }]
  }
}

/** Something a test opens when it wants what waits behind it to go on. */
function gate(): { opened: Promise<void>; open(): void } {
  let open: () => void = () => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

/** Lets the messages in flight arrive and be answered. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

/** Engines that do nothing costly and write down what they were asked. */
function fakeEngines() {
  const installed = new Set<string>(['small'])
  const log: string[] = []
  const heard: Sound[] = []
  const spoken: Sound[] = []
  const said: Array<{ text: string; how: Speaking }> = []
  const listenings: Listening[] = []
  let working = 0
  let mostAtOnce = 0
  const state = {
    /** A request for the recogniser waits here when set. */
    hearingGate: undefined as ReturnType<typeof gate> | undefined,
    speakingGate: undefined as ReturnType<typeof gate> | undefined,
    downloadGate: undefined as ReturnType<typeof gate> | undefined,
    /** Thrown by the next attempt to open the recogniser. */
    recognizerFault: undefined as Error | undefined,
    downloadFault: undefined as Error | undefined,
    downloadSignal: undefined as AbortSignal | undefined
  }

  const engines: SpeechEngines = {
    sets: [set('small', 'speech-detection', 10), set('voice', 'voice', 100), set('large', 'recognition', 1000)],
    isInstalled: (wanted) => installed.has(wanted.id),
    async install(wanted: ModelSet, { onProgress, signal }: InstallOptions) {
      log.push(`install ${wanted.id}`)
      state.downloadSignal = signal
      const total = wanted.files[0]?.bytes ?? 0
      const report = (received: number) => onProgress?.({ set: wanted.id, received, total } satisfies DownloadProgress)
      report(total / 2)
      await state.downloadGate?.opened
      signal?.throwIfAborted()
      if (state.downloadFault) throw state.downloadFault
      report(total)
      installed.add(wanted.id)
    },
    async openRecognizer() {
      log.push('open recogniser')
      if (state.recognizerFault) {
        const fault = state.recognizerFault
        state.recognizerFault = undefined
        throw fault
      }
      return {
        async transcribe(sound) {
          working++
          mostAtOnce = Math.max(mostAtOnce, working)
          heard.push(sound)
          log.push(`hear ${sound.samples.length}`)
          await state.hearingGate?.opened
          working--
          if (sound.samples.length === 13) throw new Error('thirteen samples')
          return { text: `${sound.samples.length} samples at ${sound.sampleRate}` }
        },
        close: () => void log.push('close recogniser')
      }
    },
    async openVoice() {
      log.push('open voice')
      return {
        ...engines.describeVoice(),
        styles: () => engines.describeVoice().styles,
        languages: () => engines.describeVoice().languages,
        async speak(text, how) {
          said.push({ text, how })
          log.push(`say ${text}`)
          await state.speakingGate?.opened
          if (how.style !== 'plain') throw new SpeechError('invalid', `The voice has no style called "${how.style}".`)
          // One sample for each letter, made for this answer.
          const sound = { sampleRate: 100, samples: Float32Array.from(text, (_, index) => index / 10) }
          spoken.push(sound)
          return sound
        },
        close: () => void log.push('close voice')
      }
    },
    async openDetector(listening) {
      listenings.push(listening)
      let fed = 0
      return {
        async feed(sound) {
          fed += sound.samples.length
          return fed === sound.samples.length ? [{ type: 'started', at: 0 }] : []
        },
        async end() {
          const events: SpeechEvent[] = [{ type: 'ended', start: 0, end: fed, speech: { sampleRate: 16_000, samples: new Float32Array(fed).fill(0.5) } }]
          fed = 0
          return events
        },
        close: () => void log.push('close detector')
      }
    },
    describeVoice: () => ({ styles: [{ id: 'plain', name: 'Plain' }], languages: ['en', 'fr'] })
  }
  return { engines, installed, log, heard, spoken, said, listenings, state, mostAtOnce: () => mostAtOnce }
}

const sound = (length: number, sampleRate = 16_000): Sound => ({ sampleRate, samples: Float32Array.from({ length }, (_, index) => index / length) })

let ports: MessagePort[] = []
let server: SpeechServer | undefined
let client: SpeechService | undefined
afterEach(() => {
  client?.close()
  server?.close()
  for (const port of ports) port.close()
  ports = []
})

/** A service with fake engines and a client of it. `wrap` disguises each end of the channel as another kind of port. */
function connected(wrap: (port: MessagePort) => DuplexPort = (port) => port) {
  const fake = fakeEngines()
  const { port1, port2 } = new MessageChannel()
  ports = [port1, port2]
  server = serveSpeech(wrap(port1), { folder: 'unused', tier: 'standard', engines: fake.engines })
  client = connectSpeech(wrap(port2))
  return { ...fake, speech: client, serverPort: port1, clientPort: port2 }
}

/**
 * A port that behaves like Electron's: the listener is handed an event with the message in `data`, and a
 * list of buffers to move is refused with a TypeError.
 */
function likeElectron(port: MessagePort): DuplexPort {
  return {
    postMessage(message: unknown, transfer?: never[]) {
      if (transfer !== undefined) throw new TypeError('Invalid value for transfer')
      port.postMessage(message)
    },
    on(event: string, listener: (message: unknown) => void) {
      return port.on(event, event === 'message' ? (message: unknown) => listener({ data: message, ports: [] }) : listener)
    }
  }
}

describe('the speech service', () => {
  it('says which sets are installed and what it works for', async () => {
    const { speech, log } = connected()

    const status = await speech.status()

    expect(status.sets).toEqual([
      { id: 'small', purpose: 'speech-detection', name: 'the speech-detection set', bytes: 10, installed: true },
      { id: 'voice', purpose: 'voice', name: 'the voice set', bytes: 100, installed: false },
      { id: 'large', purpose: 'recognition', name: 'the recognition set', bytes: 1000, installed: false }
    ])
    expect(status.ready).toBe(false)
    expect(status.tier).toBe('standard')
    expect(status.threads).toBeGreaterThanOrEqual(1)
    expect(log).toEqual([])
  })

  it('names the styles and languages of the voice without loading it', async () => {
    const { speech, log } = connected()

    expect(await speech.styles()).toEqual([{ id: 'plain', name: 'Plain' }])
    expect(await speech.languages()).toEqual(['en', 'fr'])
    expect(log).toEqual([])
  })

  it('loads an engine the first time it is needed, and keeps it', async () => {
    const { speech, log } = connected()

    await speech.transcribe(sound(4))
    await speech.transcribe(sound(5))
    await speech.speak('hi', { style: 'plain', language: 'en' })
    await speech.speak('ho', { style: 'plain', language: 'en' })

    expect(log).toEqual(['open recogniser', 'hear 4', 'hear 5', 'open voice', 'say hi', 'say ho'])
  })

  it('loads both engines ahead of time when asked to', async () => {
    const { speech, log } = connected()

    await speech.warmUp()
    await speech.transcribe(sound(4))

    expect(log.slice(0, 2).sort()).toEqual(['open recogniser', 'open voice'])
    expect(log.slice(2)).toEqual(['hear 4'])
  })

  describe('sound', () => {
    it('reaches the recogniser as it was sent, and stays with the caller', async () => {
      const { speech, heard } = connected()
      const mine = sound(1000, 48_000)
      const before = Array.from(mine.samples)

      expect(await speech.transcribe(mine)).toEqual({ text: '1000 samples at 48000' })

      expect(heard[0]?.sampleRate).toBe(48_000)
      expect(heard[0]?.samples).toBeInstanceOf(Float32Array)
      expect(Array.from(heard[0]?.samples ?? [])).toEqual(before)
      // The caller can go on using its sound: what was given away was a copy.
      expect(Array.from(mine.samples)).toEqual(before)
    })

    it('comes back from the voice as numbers, with the memory the voice made for it', async () => {
      const { speech, spoken, said } = connected()

      const answer = await speech.speak('hello', { style: 'plain', language: 'fr', speed: 1.2 })

      expect(said).toEqual([{ text: 'hello', how: { style: 'plain', language: 'fr', speed: 1.2 } }])
      expect(answer.sampleRate).toBe(100)
      expect(answer.samples).toBeInstanceOf(Float32Array)
      expect(Array.from(answer.samples)).toEqual(Array.from(Float32Array.from([0, 0.1, 0.2, 0.3, 0.4])))
      // Moved, not copied: the service no longer holds the samples it sent.
      expect(spoken[0]?.samples.length).toBe(0)
    })

    it('sends only the part of a larger recording that a sound is a window on', async () => {
      const { speech, heard } = connected()
      const recording = sound(1000)

      await speech.transcribe({ sampleRate: 16_000, samples: recording.samples.subarray(100, 150) })

      expect(heard[0]?.samples.length).toBe(50)
      expect(heard[0]?.samples.buffer.byteLength).toBe(50 * Float32Array.BYTES_PER_ELEMENT)
      expect(Array.from(heard[0]?.samples ?? [])).toEqual(Array.from(recording.samples.subarray(100, 150)))
      expect(recording.samples.length).toBe(1000)
    })

    it("is copied instead through a port that cannot move memory, such as Electron's", async () => {
      const { speech, heard, spoken } = connected(likeElectron)
      const mine = sound(8)

      expect(await speech.transcribe(mine)).toEqual({ text: '8 samples at 16000' })
      const answer = await speech.speak('abc', { style: 'plain', language: 'en' })
      expect(await speech.transcribe(mine)).toEqual({ text: '8 samples at 16000' })

      expect(Array.from(heard[0]?.samples ?? [])).toEqual(Array.from(mine.samples))
      expect(Array.from(answer.samples)).toEqual(Array.from(Float32Array.from([0, 0.1, 0.2])))
      // Copied: the service still holds what it sent.
      expect(spoken[0]?.samples.length).toBe(3)
    })
  })

  describe('requests', () => {
    it('are answered one at a time by an engine, in the order they came', async () => {
      const { speech, log, state, mostAtOnce } = connected()
      state.hearingGate = gate()

      const answers = Promise.all([speech.transcribe(sound(1)), speech.transcribe(sound(2)), speech.transcribe(sound(3))])
      await settled()
      // The first is being heard; the others wait their turn.
      expect(log).toEqual(['open recogniser', 'hear 1'])
      state.hearingGate.open()

      expect((await answers).map((answer) => answer.text)).toEqual(['1 samples at 16000', '2 samples at 16000', '3 samples at 16000'])
      expect(log).toEqual(['open recogniser', 'hear 1', 'hear 2', 'hear 3'])
      expect(mostAtOnce()).toBe(1)
    })

    it('for the voice do not wait for the recogniser', async () => {
      const { speech, state } = connected()
      state.hearingGate = gate()

      const hearing = speech.transcribe(sound(1))
      const answer = await speech.speak('now', { style: 'plain', language: 'en' })

      expect(answer.samples.length).toBe(3)
      state.hearingGate.open()
      await hearing
    })

    it('are still answered while an engine is busy, when they need no engine', async () => {
      const { speech, state } = connected()
      state.hearingGate = gate()
      const hearing = speech.transcribe(sound(1))

      expect((await speech.status()).tier).toBe('standard')

      state.hearingGate.open()
      await hearing
    })

    it('that are cancelled before their turn never reach the engine', async () => {
      const { speech, log, state } = connected()
      state.hearingGate = gate()
      const stop = new AbortController()

      const first = speech.transcribe(sound(1))
      const second = speech.transcribe(sound(2), { signal: stop.signal })
      const third = speech.transcribe(sound(3))
      await settled()
      stop.abort()

      await expect(second).rejects.toMatchObject({ name: 'AbortError' })
      // The caller is told at once; the service learns of it a moment later, well before the request's turn.
      await settled()
      state.hearingGate.open()
      await Promise.all([first, third])
      expect(log).toEqual(['open recogniser', 'hear 1', 'hear 3'])
    })

    it('are refused at once when already cancelled', async () => {
      const { speech, log } = connected()

      await expect(speech.speak('late', { style: 'plain', language: 'en' }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
      await settled()
      expect(log).toEqual([])
    })
  })

  describe('errors', () => {
    it('come back as rejections that keep their kind and their message', async () => {
      const { speech } = connected()

      const failure = await speech.speak('hello', { style: 'robot', language: 'en' }).catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(SpeechError)
      expect(failure).toMatchObject({ code: 'invalid', message: 'The voice has no style called "robot".' })
    })

    it('say when a model set is missing, and the engine is asked for again once it may be there', async () => {
      const { speech, log, state } = connected()
      state.recognizerFault = new SpeechError('not-installed', 'Speech recognition is not downloaded yet.')

      await expect(speech.transcribe(sound(4))).rejects.toMatchObject({ code: 'not-installed', message: 'Speech recognition is not downloaded yet.' })
      expect(await speech.transcribe(sound(4))).toEqual({ text: '4 samples at 16000' })

      expect(log).toEqual(['open recogniser', 'open recogniser', 'hear 4'])
    })

    it('of an unforeseen kind are told too, and do not stop the requests behind them', async () => {
      const { speech } = connected()
      const written = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

      try {
        const answers = await Promise.allSettled([speech.transcribe(sound(13)), speech.transcribe(sound(2))])

        expect(answers[0]).toMatchObject({ status: 'rejected', reason: { code: 'failed', message: 'Speech stopped working: thirteen samples' } })
        expect(answers[1]).toMatchObject({ status: 'fulfilled', value: { text: '2 samples at 16000' } })
        // Where it happened is kept for whoever looks into it, on the service's error output.
        expect(written).toHaveBeenCalledTimes(1)
        expect(written.mock.calls[0]?.[0]).toContain('speech: "transcribe" failed: Error: thirteen samples\n    at ')
      } finally {
        written.mockRestore()
      }
    })

    it('answer a request the service cannot read', async () => {
      const { clientPort } = connected()
      const replies: unknown[] = []
      clientPort.on('message', (reply) => replies.push(reply))

      // Samples as a list of numbers are not a sound.
      clientPort.postMessage({ id: 900, call: 'transcribe', input: { sound: { sampleRate: 16_000, samples: [0, 0.5] } } })
      clientPort.postMessage({ id: 901, call: 'sing', input: {} })
      clientPort.postMessage('hello')
      // The refusal crosses a message channel, which takes longer than a fixed wait on a busy machine; once it
      // has come, a little more time shows the other two get no answer.
      await vi.waitFor(() => expect(replies).toHaveLength(1))
      await settled()

      expect(replies).toEqual([{ id: 900, reply: 'failed', code: 'invalid', message: 'The speech service was sent a "transcribe" request it cannot read.' }])
    })

    it('reject what is waiting, and what comes after, when the service is gone', async () => {
      const { speech, state, serverPort } = connected()
      state.hearingGate = gate()
      const waiting = speech.transcribe(sound(1))
      await settled()

      serverPort.close()

      await expect(waiting).rejects.toMatchObject({ code: 'failed', message: 'The speech service stopped.' })
      await expect(speech.status()).rejects.toMatchObject({ message: 'The speech service stopped.' })
    })
  })

  describe('installing', () => {
    it('downloads the sets that are missing, and says how far everything has got', async () => {
      const { speech, log } = connected()
      const progress: InstallProgress[] = []

      await speech.install((step) => progress.push(step))

      expect(log).toEqual(['install voice', 'install large'])
      expect(progress).toEqual([
        { received: 10 + 50, total: 1110, current: { set: 'voice', received: 50, total: 100 } },
        { received: 10 + 100, total: 1110, current: { set: 'voice', received: 100, total: 100 } },
        { received: 110 + 500, total: 1110, current: { set: 'large', received: 500, total: 1000 } },
        { received: 110 + 1000, total: 1110, current: { set: 'large', received: 1000, total: 1000 } }
      ])
      expect((await speech.status()).ready).toBe(true)
    })

    it('does nothing when everything is there', async () => {
      const { speech, log, installed } = connected()
      installed.add('voice').add('large')
      const progress: InstallProgress[] = []

      await speech.install((step) => progress.push(step))

      expect(log).toEqual([])
      expect(progress).toEqual([])
    })

    it('downloads once when asked twice at the same time, and tells both', async () => {
      const { speech, log, state } = connected()
      state.downloadGate = gate()
      const first: InstallProgress[] = []
      const second: InstallProgress[] = []

      const both = Promise.all([speech.install((step) => first.push(step)), speech.install((step) => second.push(step))])
      await settled()
      state.downloadGate.open()
      await both

      expect(log).toEqual(['install voice', 'install large'])
      expect(first.at(-1)).toEqual({ received: 1110, total: 1110, current: { set: 'large', received: 1000, total: 1000 } })
      expect(second.at(-1)).toEqual(first.at(-1))
    })

    it('stops the download when cancelled', async () => {
      const { speech, state, installed } = connected()
      state.downloadGate = gate()
      const stop = new AbortController()

      const installing = speech.install(undefined, { signal: stop.signal })
      await settled()
      stop.abort()

      await expect(installing).rejects.toMatchObject({ name: 'AbortError' })
      await settled()
      expect(state.downloadSignal?.aborted).toBe(true)
      state.downloadGate.open()
      await settled()
      expect(installed.has('voice')).toBe(false)

      // The next request starts a download of its own.
      state.downloadGate = undefined
      await speech.install()
      expect(installed.has('large')).toBe(true)
    })

    it('says why a download failed, in words for the user', async () => {
      const { speech, state } = connected()
      state.downloadFault = new ModelDownloadError('Could not download the voice set: the server could not be reached. Check the connection and try again.')

      await expect(speech.install()).rejects.toMatchObject({
        code: 'failed',
        message: 'Could not download the voice set: the server could not be reached. Check the connection and try again.'
      })
    })
  })

  describe('detecting speech', () => {
    it('opens a detector that is fed, ended and closed from the client', async () => {
      const { speech, listenings, log } = connected()

      const detector = await speech.listen({ silence: 0.7 })
      const piece = sound(160)
      const whileFed = [...(await detector.feed(piece)), ...(await detector.feed(piece))]
      const atTheEnd = await detector.end()

      expect(listenings).toEqual([{ silence: 0.7 }])
      expect(whileFed).toEqual([{ type: 'started', at: 0 }])
      expect(atTheEnd.length).toBe(1)
      expect(atTheEnd[0]).toMatchObject({ type: 'ended', start: 0, end: 320, speech: { sampleRate: 16_000 } })
      const speech16k = (atTheEnd[0] as SpeechEvent & { type: 'ended' }).speech.samples
      expect(speech16k).toBeInstanceOf(Float32Array)
      expect(Array.from(speech16k)).toEqual(new Array(320).fill(0.5))
      // The pieces fed stay with the caller.
      expect(piece.samples.length).toBe(160)

      detector.close()
      await settled()
      expect(log).toEqual(['close detector'])
      await expect(detector.feed(piece)).rejects.toMatchObject({ code: 'invalid', message: 'This speech detector was closed.' })
    })

    it('keeps the detectors apart', async () => {
      const { speech, listenings } = connected()

      const one = await speech.listen()
      const other = await speech.listen({ silence: 2 })
      await one.feed(sound(10))

      expect(listenings).toEqual([{}, { silence: 2 }])
      expect(await other.feed(sound(10))).toEqual([{ type: 'started', at: 0 }])
      expect((await one.end())[0]).toMatchObject({ end: 10 })
    })
  })

  it('lets go of its engines when it stops', async () => {
    const { speech, log } = connected()
    await speech.warmUp()
    await speech.listen()

    server?.close()
    await settled()

    expect(log.slice(2).sort()).toEqual(['close detector', 'close recogniser', 'close voice'])
  })
})

/**
 * The ports Electron gives, as its type declarations describe them, written out here because this package
 * does not depend on Electron. If these stop being accepted as they are, this file no longer compiles.
 */
interface ElectronUtilityProcess {
  postMessage(message: unknown, transfer?: Array<{ close(): void }>): void
  on(event: 'exit', listener: (code: number) => void): this
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'spawn', listener: () => void): this
}
interface ElectronParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (messageEvent: { data: unknown; ports: unknown[] }) => void): this
}
export type AcceptedAsTheyAre = [
  Parameters<typeof connectSpeech>[0] extends infer Port ? (ElectronUtilityProcess extends Port ? true : never) : never,
  Parameters<typeof serveSpeech>[0] extends infer Port ? (ElectronParentPort extends Port ? true : never) : never
]
const accepted: AcceptedAsTheyAre = [true, true]
void accepted
