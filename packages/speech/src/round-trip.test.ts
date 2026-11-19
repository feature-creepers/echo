import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openRecognizer, openSpeechDetector, openVoice, type Recognizer, type Sound, type SpeechDetector, type SpeechEvent, type Voice } from './index.ts'

/**
 * The engines with their real models: what is said is heard back. These tests need the model sets, which
 * weigh too much to download on every run, so they run only when SPEECH_MODELS names a folder where the
 * sets are installed:
 *
 *   SPEECH_MODELS=/path/to/models pnpm --filter @repo/speech test
 */
const MODELS = process.env.SPEECH_MODELS ?? ''

const ENGLISH = 'A mushroom risotto would work. Forty minutes, and it suits your vegetarian guest.'
const FRENCH = 'Un risotto aux champignons conviendrait. Quarante minutes, et il convient à votre invité végétarien.'

const seconds = (sound: Sound) => sound.samples.length / sound.sampleRate
const silence = (length: number, sampleRate: number): Sound => ({ sampleRate, samples: new Float32Array(Math.round(length * sampleRate)) })

/** Sounds one after the other. They share a rate. */
function joined(...sounds: Sound[]): Sound {
  const samples = new Float32Array(sounds.reduce((sum, sound) => sum + sound.samples.length, 0))
  let at = 0
  for (const sound of sounds) {
    samples.set(sound.samples, at)
    at += sound.samples.length
  }
  return { sampleRate: (sounds[0] as Sound).sampleRate, samples }
}

/** A sound cut in pieces of a tenth of a second, as a microphone delivers it. */
function pieces(sound: Sound): Sound[] {
  const size = Math.round(sound.sampleRate / 10)
  const cut: Sound[] = []
  for (let at = 0; at < sound.samples.length; at += size) cut.push({ sampleRate: sound.sampleRate, samples: sound.samples.slice(at, at + size) })
  return cut
}

/** Every other sample: the same sound at half the rate. */
const halved = (sound: Sound): Sound => ({ sampleRate: sound.sampleRate / 2, samples: sound.samples.filter((_, index) => index % 2 === 0) })

/**
 * The voice says a sentence a little differently each time, and now and then the recogniser mishears a word
 * of it. So a sentence counts as heard when its key words came back, all but one at most.
 */
function expectHeard(text: string, words: string[]): void {
  const missing = words.filter((word) => !text.toLowerCase().includes(word))
  expect(missing.length, `heard "${text}", without: ${missing.join(', ')}`).toBeLessThanOrEqual(1)
}

const ENGLISH_WORDS = ['mushroom', 'risotto', 'minutes', 'vegetarian', 'guest']
const FRENCH_WORDS = ['risotto', 'champignon', 'minutes', 'invité', 'végétarien']

const timings: string[] = []
async function timed<Outcome>(label: string, work: () => Promise<Outcome>, ofSound?: (outcome: Outcome) => number): Promise<Outcome> {
  const started = performance.now()
  const outcome = await work()
  const took = performance.now() - started
  const speed = ofSound ? `, ${((ofSound(outcome) * 1000) / took).toFixed(1)} times faster than real time` : ''
  timings.push(`${label}: ${Math.round(took)} ms${speed}`)
  return outcome
}

describe.runIf(MODELS)('the engines, with their real models', { timeout: 120_000 }, () => {
  let recognizer: Recognizer
  let voice: Voice
  let english: Sound
  let french: Sound

  beforeAll(async () => {
    voice = await timed('loading the voice', () => openVoice({ folder: MODELS }))
    recognizer = await timed('loading the recogniser', () => openRecognizer({ folder: MODELS }))
    // The first sentence pays for warming the model up; it is measured apart from the others.
    await timed('speaking a first sentence', () => voice.speak('Ready.', { style: 'f1', language: 'en' }))
    english = await timed('speaking English', () => voice.speak(ENGLISH, { style: 'f1', language: 'en' }), seconds)
    french = await timed('speaking French', () => voice.speak(FRENCH, { style: 'm1', language: 'fr' }), seconds)
  }, 120_000)

  afterAll(() => {
    recognizer?.close()
    voice?.close()
    console.info(`\nSpeech engines, measured:\n  ${timings.join('\n  ')}\n`)
  })

  it('speaks English and hears it back', async () => {
    expect(english.sampleRate).toBe(44_100)
    expect(seconds(english)).toBeGreaterThan(3)
    expect(seconds(english)).toBeLessThan(12)

    const heard = await timed(
      'hearing English',
      () => recognizer.transcribe(english),
      () => seconds(english)
    )

    expectHeard(heard.text, ENGLISH_WORDS)
  })

  it('speaks French and hears it back', async () => {
    const heard = await timed(
      'hearing French',
      () => recognizer.transcribe(french),
      () => seconds(french)
    )

    expectHeard(heard.text, FRENCH_WORDS)
  })

  it('speaks in every style it offers, each with a sound of its own', async () => {
    const styles = voice.styles()
    expect(styles.length).toBe(10)

    const lengths = new Set<number>()
    const misheard: string[] = []
    for (const style of styles) {
      const sound = await voice.speak('The weather is fine today.', { style: style.id, language: 'en' })
      lengths.add(sound.samples.length)
      const { text } = await recognizer.transcribe(sound)
      if (!text.toLowerCase().includes('weather')) misheard.push(`${style.name}: "${text}"`)
    }
    expect(misheard.length, misheard.join('; ')).toBeLessThanOrEqual(1)
    expect(lengths.size).toBeGreaterThan(5)
  })

  it('speaks faster when asked to', async () => {
    const usual = await voice.speak(ENGLISH, { style: 'f3', language: 'en' })
    const fast = await voice.speak(ENGLISH, { style: 'f3', language: 'en', speed: 1.5 })

    expect(seconds(fast)).toBeLessThan(seconds(usual) * 0.85)
  })

  it('takes a language written as a locale, and refuses one it does not speak or a style it does not have', async () => {
    expect(seconds(await voice.speak('Bonjour à tous.', { style: 'f1', language: 'fr-FR' }))).toBeGreaterThan(0.5)

    await expect(voice.speak('Hello.', { style: 'f1', language: 'xx' })).rejects.toThrow('The voice does not speak the language "xx".')
    await expect(voice.speak('Hello.', { style: 'robot', language: 'en' })).rejects.toThrow('The voice has no style called "robot".')
  })

  it('makes no sound for a sentence with nothing to say', async () => {
    expect((await voice.speak('', { style: 'f1', language: 'en' })).samples.length).toBe(0)
    expect((await voice.speak('   ', { style: 'f1', language: 'en' })).samples.length).toBe(0)
  })

  it('hears sound at another rate', async () => {
    const heard = await recognizer.transcribe(halved(english))

    expect(halved(english).sampleRate).toBe(22_050)
    expectHeard(heard.text, ENGLISH_WORDS)
  })

  it('hears the person’s own words as they write them once given, and the rest as before', async () => {
    const words = ['Rodolphe Barbanneau', 'Supertonic', 'Kerjean']
    // The voice says it a little differently each time: the name is heard in most of three, and never without the words.
    let plain = 0
    let favoured = 0
    for (let time = 0; time < 3; time++) {
      const names = await voice.speak('Ask Rodolphe Barbanneau about the Supertonic voice.', { style: 'm3', language: 'en' })
      if ((await recognizer.transcribe(names)).text.includes('Barbanneau')) plain++
      const heard = await timed(
        'hearing with words of the person’s own',
        () => recognizer.transcribe(names, { words }),
        () => seconds(names)
      )
      if (heard.text.includes('Barbanneau')) favoured++
    }
    expect(plain).toBe(0)
    expect(favoured).toBeGreaterThanOrEqual(2)
    // Words that were not said are not heard instead of others, and once none are given, hearing is as before.
    expectHeard((await recognizer.transcribe(english, { words })).text, ENGLISH_WORDS)
    expectHeard((await recognizer.transcribe(english)).text, ENGLISH_WORDS)
  })

  it('hears nothing in silence, nor in no sound at all', async () => {
    expect(await recognizer.transcribe(silence(2, 16_000))).toEqual({ text: '' })
    expect(await recognizer.transcribe(silence(0, 48_000))).toEqual({ text: '' })
  })

  it('answers requests made at the same time, each with its own sound', async () => {
    const [first, second] = await Promise.all([recognizer.transcribe(english), recognizer.transcribe(french)])

    expectHeard(first.text, ENGLISH_WORDS)
    expectHeard(second.text, FRENCH_WORDS)
  })

  describe('detecting speech', () => {
    let detector: SpeechDetector
    const BEFORE = 1.5
    const AFTER = 2

    beforeAll(async () => {
      detector = await timed('loading the speech detector', () => openSpeechDetector({ folder: MODELS }))
    })
    afterAll(() => detector?.close())

    it('finds where speech starts and ends in a sound with silence around it', async () => {
      const recording = joined(silence(BEFORE, 44_100), english, silence(AFTER, 44_100))
      const events: Array<SpeechEvent & { heardAt: number }> = []
      let fed = 0
      const started = performance.now()
      for (const piece of pieces(recording)) {
        fed += seconds(piece)
        for (const event of await detector.feed(piece)) events.push({ ...event, heardAt: fed })
      }
      timings.push(`detecting speech in ${seconds(recording).toFixed(1)} s of sound: ${Math.round(performance.now() - started)} ms`)
      expect(await detector.end()).toEqual([])

      expect(events.map((event) => event.type)).toEqual(['started', 'ended'])
      const [start, end] = events as [SpeechEvent & { type: 'started'; heardAt: number }, SpeechEvent & { type: 'ended'; heardAt: number }]

      // The voice itself begins and ends a sentence with a moment of quiet, hence the margins.
      expect(start.at).toBeGreaterThan(BEFORE - 0.4)
      expect(start.at).toBeLessThan(BEFORE + 0.6)
      // The start is first told as an estimate, then with the speech itself: the two agree to a few hundredths of a second.
      expect(Math.abs(end.start - start.at)).toBeLessThan(0.1)
      expect(end.end).toBeGreaterThan(BEFORE + seconds(english) - 0.8)
      expect(end.end).toBeLessThan(BEFORE + seconds(english) + 0.3)
      // Known as soon as the silence had lasted a second: push to talk can stop there, without waiting for the rest.
      expect(end.heardAt).toBeLessThan(BEFORE + seconds(english) + 1.5)

      // What it cut out is the sentence, whole, ready for the recogniser.
      expect(end.speech.sampleRate).toBe(16_000)
      expect(seconds(end.speech)).toBeCloseTo(end.end - end.start, 5)
      expectHeard((await recognizer.transcribe(end.speech)).text, ENGLISH_WORDS)
    })

    it('counts time from the start again for the next sound, and ends speech that the end of the sound cuts short', async () => {
      const events: SpeechEvent[] = []
      for (const piece of pieces(joined(silence(0.5, 44_100), french))) events.push(...(await detector.feed(piece)))
      expect(events.map((event) => event.type)).toEqual(['started'])
      expect((events[0] as SpeechEvent & { type: 'started' }).at).toBeLessThan(1.1)

      const atTheEnd = await detector.end()

      expect(atTheEnd.map((event) => event.type)).toEqual(['ended'])
      const ended = atTheEnd[0] as SpeechEvent & { type: 'ended' }
      expect(ended.end).toBeCloseTo(0.5 + seconds(french), 0)
      expectHeard((await recognizer.transcribe(ended.speech)).text, FRENCH_WORDS)
    })

    it('hears no speech in silence', async () => {
      const events: SpeechEvent[] = []
      for (const piece of pieces(silence(3, 48_000))) events.push(...(await detector.feed(piece)))
      events.push(...(await detector.end()))

      expect(events).toEqual([])
    })

    it('waits for as long a silence as it is told', async () => {
      const patient = await openSpeechDetector({ folder: MODELS, silence: 3 })
      const hasty = await openSpeechDetector({ folder: MODELS, silence: 0.3 })
      const recording = pieces(joined(english, silence(AFTER, 44_100)))
      try {
        const whilePatient: SpeechEvent[] = []
        const whileHasty: Array<SpeechEvent & { heardAt: number }> = []
        let fed = 0
        for (const piece of recording) {
          fed += seconds(piece)
          whilePatient.push(...(await patient.feed(piece)))
          for (const event of await hasty.feed(piece)) whileHasty.push({ ...event, heardAt: fed })
        }

        // Two seconds of silence are not three: for the patient one, the speech is still going on.
        expect(whilePatient.map((event) => event.type)).toEqual(['started'])
        // The hasty one may split the sentence at its full stop, and is done soon after the last word.
        expect(whileHasty.at(-1)?.type).toBe('ended')
        expect(whileHasty.at(-1)?.heardAt).toBeLessThan(seconds(english) + 0.8)
      } finally {
        patient.close()
        hasty.close()
      }
    })
  })
})
