import type { DeviceVoice } from '@repo/client'
import { clauses } from './clauses.ts'
import { route } from './devices.ts'
import type { SpeechEngine } from './engine.ts'
import { loudness } from './recorder.ts'
import { readBands } from './spectrum.ts'

/** A voice that speaks through the device's engine, and says how loud it is so the core can move with it. */
export interface SpeakingVoice extends DeviceVoice {
  /** How loud what is being said is right now, from 0 to 1. */
  level(): number
  /** Its spectrum right now, read into the bands given, from the low notes to the high; nothing before it first spoke. */
  bands(into: Float32Array): Float32Array | undefined
  /** Let its sound go once what it is saying has been said, so a voice no longer used holds no audio of the system's. */
  close(): void
}

/** How the voice speaks, read for each sentence so that a change of settings applies to the next one. */
interface VoiceManner {
  /** The style to speak a sentence in, by its language: a persona may sound otherwise from one language to the next. */
  style(language: string): string
  /** The pace, 1 being the voice's own. */
  speed(): number
  /** The output device to play on. Nothing for the system's choice. */
  sink(): string | undefined
  /** A sentence as it is said, when that differs from how it is written: names in capitals, for instance. */
  spoken(text: string): string
}

/** The language of a sentence that does not say its own. */
const FALLBACK_LANGUAGE = 'en'

/**
 * Says each sentence through the speech engine and the speakers. The next sentence is made while this one
 * plays, so there is no gap between them, and a long sentence is made a clause at a time, so it starts sooner.
 * When the engine fails, the sentence is held silent for the time it would take to read, so the caption keeps
 * its pace.
 */
export function engineVoice(engine: SpeechEngine, how: VoiceManner): SpeakingVoice {
  /** The device the sound goes to now, so that it is changed only when the setting is. */
  let routed: string | undefined
  let output: { context: AudioContext; analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer>; spectrum: Float32Array<ArrayBuffer> } | undefined
  /** Sound being made ahead, by sentence text: one piece per clause, in order. */
  const ahead = new Map<string, Promise<AudioBuffer | undefined>[]>()
  /** Sentences under way, and whether the voice was closed: its sound goes once the last of them ends. */
  let saying = 0
  let closed = false

  const ready = () => {
    if (!output) {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      // Quick enough that the core follows each syllable's notes.
      analyser.smoothingTimeConstant = 0.5
      analyser.connect(context.destination)
      output = { context, analyser, buffer: new Float32Array(analyser.fftSize), spectrum: new Float32Array(analyser.frequencyBinCount) }
      routed = undefined
    }
    return output
  }

  const release = () => {
    if (!closed || saying > 0 || !output) return
    void output.context.close()
    output = undefined
  }

  /** Ask for the sound of each clause of a sentence at once: the engine makes them in order, the first first. */
  const make = (text: string, language: string | undefined) => {
    const known = ahead.get(text)
    if (known) return known
    const { context } = ready()
    const speed = how.speed()
    const spokenIn = language ?? FALLBACK_LANGUAGE
    const style = how.style(spokenIn)
    const made = clauses(text).map((piece) =>
      engine.speak(how.spoken(piece), { language: spokenIn, style, ...(speed === 1 ? {} : { speed }) }).then(
        (sound) => {
          const out = context.createBuffer(1, sound.samples.length, sound.sampleRate)
          out.copyToChannel(new Float32Array(sound.samples), 0)
          return out
        },
        () => undefined
      )
    )
    ahead.set(text, made)
    return made
  }

  return {
    pause() {
      void output?.context.suspend()
    },
    resume() {
      void output?.context.resume()
    },
    prepare(sentence) {
      void make(sentence.text, sentence.language)
    },
    level() {
      if (!output) return 0
      output.analyser.getFloatTimeDomainData(output.buffer)
      return loudness(output.buffer)
    },
    bands(into) {
      if (!output) return undefined
      return readBands(output.analyser, output.spectrum, into)
    },
    close() {
      closed = true
      ahead.clear()
      release()
    },
    say(sentence) {
      let cancelled = false
      const sources: AudioBufferSourceNode[] = []
      let timer: number | undefined
      const { promise: done, resolve: finish } = Promise.withResolvers<void>()
      // Resolved when the sound starts, with its length: the caption appears with the voice, not before it.
      const { promise: heard, resolve: start } = Promise.withResolvers<number | undefined>()
      saying += 1
      void done.then(() => {
        start(undefined)
        saying -= 1
        release()
      })
      const pieces = make(sentence.text, sentence.language)
      ahead.delete(sentence.text)
      const play = async () => {
        const first = await pieces[0]
        if (cancelled) return finish()
        if (!first) {
          const ms = Math.max(1200, sentence.text.length * 55)
          timer = window.setTimeout(finish, ms)
          start(ms / 1000)
          return
        }
        const { context: out, analyser: meter } = ready()
        const sink = how.sink()
        if (sink !== routed) {
          routed = sink
          void route(out, sink)
        }
        void out.resume()
        // Each clause is set to start where the one before ends, so they run together with no gap.
        let at = out.currentTime
        let waiting = pieces.length
        const queue = (sound: AudioBuffer) => {
          const source = out.createBufferSource()
          source.buffer = sound
          source.connect(meter)
          at = Math.max(at, out.currentTime)
          source.start(at)
          at += sound.duration
          sources.push(source)
          source.onended = () => {
            if (waiting === 0 && source === sources.at(-1)) finish()
          }
        }
        queue(first)
        waiting -= 1
        // The whole sentence lasts about as long as its first clause, in proportion to its letters.
        const firstLetters = clauses(sentence.text)[0]?.length ?? sentence.text.length
        start((first.duration * sentence.text.length) / Math.max(1, firstLetters))
        for (const piece of pieces.slice(1)) {
          const sound = await piece
          waiting -= 1
          if (cancelled) return
          if (sound) queue(sound)
        }
        // The last clauses failed, and what was queued has already played: the sentence is over.
        if (at <= out.currentTime) finish()
      }
      void play()
      return {
        done,
        heard,
        cancel() {
          cancelled = true
          window.clearTimeout(timer)
          for (const source of sources) {
            try {
              source.stop()
            } catch {
              // It had not started, or had already ended.
            }
          }
          // What was made ahead belongs to what is cut with it: the player drops those sentences too.
          ahead.clear()
          finish()
        }
      }
    }
  }
}
