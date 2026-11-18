import type { DeviceVoice } from '@repo/client'
import { clauses } from './clauses.ts'
import { route } from './devices.ts'
import type { SpeechEngine } from './engine.ts'
import { loudness } from './recorder.ts'

/** A voice that speaks through the device's engine, and says how loud it is so the core can move with it. */
export interface SpeakingVoice extends DeviceVoice {
  /** How loud what is being said is right now, from 0 to 1. */
  level(): number
}

/** How the voice speaks, read for each sentence so that a change of settings applies to the next one. */
export interface VoiceManner {
  style(): string
  /** The pace, 1 being the voice's own. */
  speed?: () => number
  /** The output device to play on. Nothing for the system's choice. */
  sink?: () => string | undefined
  /** A sentence as it is said, when that differs from how it is written: names in capitals, for instance. */
  spoken?: (text: string) => string
}

/**
 * Says each sentence through the speech engine and the speakers. The next sentence is made while this one
 * plays, so there is no gap between them, and a long sentence is made a clause at a time, so it starts sooner.
 * When the engine fails, the sentence is held silent for the time it would take to read, so the caption keeps
 * its pace.
 */
export function engineVoice(engine: SpeechEngine, manner: VoiceManner | (() => string), fallbackLanguage = 'en'): SpeakingVoice {
  const how: VoiceManner = typeof manner === 'function' ? { style: manner } : manner
  /** The device the sound goes to now, so that it is changed only when the setting is. */
  let routed: string | undefined
  let context: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let buffer: Float32Array<ArrayBuffer> | undefined
  /** Sound being made ahead, by sentence text: one piece per clause, in order. */
  const ahead = new Map<string, Promise<AudioBuffer | undefined>[]>()

  const ready = () => {
    if (!context) {
      context = new AudioContext()
      analyser = context.createAnalyser()
      analyser.fftSize = 1024
      analyser.connect(context.destination)
      buffer = new Float32Array(analyser.fftSize)
    }
    return { context, analyser: analyser as AnalyserNode }
  }

  /** Ask for the sound of each clause of a sentence at once: the engine makes them in order, the first first. */
  const make = (text: string, language: string | undefined) => {
    const known = ahead.get(text)
    if (known) return known
    const { context: audio } = ready()
    const speed = how.speed?.() ?? 1
    const style = how.style()
    const made = clauses(text).map((piece) =>
      engine.speak(how.spoken?.(piece) ?? piece, { language: language ?? fallbackLanguage, style, ...(speed === 1 ? {} : { speed }) }).then(
        (sound) => {
          const out = audio.createBuffer(1, sound.samples.length, sound.sampleRate)
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
      void context?.suspend()
    },
    resume() {
      void context?.resume()
    },
    prepare(sentence) {
      void make(sentence.text, sentence.language)
    },
    level() {
      if (!analyser || !buffer) return 0
      analyser.getFloatTimeDomainData(buffer)
      return loudness(buffer)
    },
    say(sentence) {
      let cancelled = false
      const sources: AudioBufferSourceNode[] = []
      let timer: number | undefined
      let finish: () => void = () => undefined
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      // Resolved when the sound starts, with its length: the caption appears with the voice, not before it.
      let start: (seconds: number | undefined) => void = () => undefined
      const heard = new Promise<number | undefined>((resolve) => {
        start = resolve
      })
      void done.then(() => start(undefined))
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
        const sink = how.sink?.()
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
          finish()
        }
      }
    }
  }
}
