import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { Sound, SpeechEvent } from '../ports.ts'
import { connectSpeech, type SpeechService } from './client.ts'

/**
 * The service as the program it is, started in a real worker thread from its entry point, the way the app
 * starts it. Without models, this checks everything up to the engines on the system the tests run on.
 * With SPEECH_MODELS naming a folder where the sets are installed, it checks the whole path: a sentence
 * spoken, detected and heard back through the service.
 */
const ENTRY = new URL('./process.ts', import.meta.url)
const MODELS = process.env.SPEECH_MODELS ?? ''

const folders: string[] = []
const workers: Worker[] = []
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
  for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true, maxRetries: 5 })
})

function emptyFolder(): string {
  const created = mkdtempSync(join(tmpdir(), 'speech-test-'))
  folders.push(created)
  return created
}

/** Start the service with these arguments. Gives its client, what it wrote on its error output, and its end. */
function start(args: string[]): { speech: SpeechService; errors: () => string; exited: Promise<number> } {
  const worker = new Worker(ENTRY, { argv: args, stderr: true })
  workers.push(worker)
  let errors = ''
  worker.stderr.setEncoding('utf8').on('data', (text: string) => (errors += text))
  const exited = new Promise<number>((resolve) => worker.once('exit', resolve))
  worker.on('error', (error) => (errors += String(error)))
  return { speech: connectSpeech(worker), errors: () => errors, exited }
}

describe('the speech service as a program', { timeout: 60_000 }, () => {
  it('answers from a thread of its own, and says what is not downloaded yet', async () => {
    const { speech } = start(['--models', emptyFolder(), '--tier', 'light'])

    const status = await speech.status()

    expect(status.tier).toBe('light')
    expect(status.ready).toBe(false)
    expect(status.sets.map((set) => [set.purpose, set.installed])).toEqual([
      ['speech-detection', false],
      ['voice', false],
      ['recognition', false]
    ])
    expect((await speech.styles()).length).toBe(10)
    expect(await speech.languages()).toEqual(expect.arrayContaining(['en', 'fr']))

    const sound: Sound = { sampleRate: 16_000, samples: new Float32Array(16_000) }
    await expect(speech.transcribe(sound)).rejects.toMatchObject({ code: 'not-installed', message: 'Speech recognition is not downloaded yet.' })
    await expect(speech.speak('Hello.', { style: 'f1', language: 'en' })).rejects.toMatchObject({
      code: 'not-installed',
      message: 'Voice is not downloaded yet.'
    })
    await expect(speech.listen()).rejects.toMatchObject({ code: 'not-installed', message: 'Speech detection is not downloaded yet.' })
  })

  it('tells its client when it ends', async () => {
    const { speech, exited } = start(['--models', emptyFolder()])
    await speech.status()

    await workers[0]?.terminate()
    await exited

    await expect(speech.status()).rejects.toMatchObject({ message: 'The speech service stopped.' })
  })

  it('refuses to start without a model folder, or for a tier that does not exist', async () => {
    const missing = start([])
    expect(await missing.exited).toBe(2)
    expect(missing.errors()).toContain('The speech service cannot start: the --models option is missing')

    const wrong = start(['--models', emptyFolder(), '--tier', 'gigantic'])
    expect(await wrong.exited).toBe(2)
    expect(wrong.errors()).toContain('"gigantic" is not a hardware tier. The tiers are: light, standard, performance.')
  })
})

describe.runIf(MODELS)('the speech service as a program, with the real models', { timeout: 120_000 }, () => {
  const seconds = (sound: Sound) => sound.samples.length / sound.sampleRate
  const timings: string[] = []
  async function timed<Outcome>(label: string, work: () => Promise<Outcome>): Promise<Outcome> {
    const started = performance.now()
    const outcome = await work()
    timings.push(`${label}: ${Math.round(performance.now() - started)} ms`)
    return outcome
  }
  /** All but one of the words at most: the voice varies, and the recogniser mishears one now and then. */
  function expectHeard(text: string, words: string[]): void {
    const missing = words.filter((word) => !text.toLowerCase().includes(word))
    expect(missing.length, `heard "${text}", without: ${missing.join(', ')}`).toBeLessThanOrEqual(1)
  }

  it('speaks, detects and hears, in English and in French', async () => {
    const { speech, errors } = start(['--models', MODELS])

    expect((await speech.status()).ready).toBe(true)
    await timed('through the service: loading both engines', () => speech.warmUp())
    // Nothing left to download.
    await speech.install()

    const english = await timed('through the service: speaking English', () =>
      speech.speak('A mushroom risotto would work. Forty minutes, and it suits your vegetarian guest.', { style: 'f1', language: 'en' })
    )
    const french = await timed('through the service: speaking French', () =>
      speech.speak('Un risotto aux champignons conviendrait. Quarante minutes, et il convient à votre invité végétarien.', { style: 'm2', language: 'fr' })
    )
    expect(english.sampleRate).toBe(44_100)
    expect(seconds(english)).toBeGreaterThan(3)

    const [heardEnglish, heardFrench] = await timed('through the service: hearing both', () =>
      Promise.all([speech.transcribe(english), speech.transcribe(french)])
    )
    expectHeard(heardEnglish.text, ['mushroom', 'risotto', 'minutes', 'vegetarian', 'guest'])
    expectHeard(heardFrench.text, ['risotto', 'champignon', 'minutes', 'invité', 'végétarien'])
    // The sounds are still the caller's after being sent.
    expect(seconds(english)).toBeGreaterThan(3)

    // A recording as a microphone delivers it: silence, the sentence, silence, in tenths of a second.
    const recording = new Float32Array(english.samples.length + 3 * 44_100)
    recording.set(english.samples, 44_100)
    const detector = await speech.listen()
    const events: SpeechEvent[] = []
    await timed(`through the service: detecting speech in ${(recording.length / 44_100).toFixed(1)} s of sound`, async () => {
      for (let at = 0; at < recording.length; at += 4_410) {
        events.push(...(await detector.feed({ sampleRate: 44_100, samples: recording.subarray(at, at + 4_410) })))
      }
      events.push(...(await detector.end()))
    })
    detector.close()

    expect(events.map((event) => event.type)).toEqual(['started', 'ended'])
    const ended = events[1] as SpeechEvent & { type: 'ended' }
    expect(ended.start).toBeGreaterThan(0.6)
    expect(ended.start).toBeLessThan(1.6)
    expect(ended.end).toBeGreaterThan(1 + seconds(english) - 0.8)
    expect(ended.end).toBeLessThan(1 + seconds(english) + 0.3)
    expectHeard((await speech.transcribe(ended.speech)).text, ['mushroom', 'risotto', 'minutes', 'vegetarian', 'guest'])

    await expect(speech.speak('Hello.', { style: 'f1', language: 'xx' })).rejects.toMatchObject({
      code: 'invalid',
      message: 'The voice does not speak the language "xx".'
    })
    expect(errors()).toBe('')
  })

  afterAll(() => console.info(`\nSpeech service in a worker thread, measured:\n  ${timings.join('\n  ')}\n`))
})
