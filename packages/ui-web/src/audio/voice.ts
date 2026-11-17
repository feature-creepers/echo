import type { DeviceVoice } from '@repo/client'
import type { SpeechEngine } from './engine.ts'
import { loudness } from './recorder.ts'

/** A voice that speaks through the device's engine, and says how loud it is so the core can move with it. */
export interface SpeakingVoice extends DeviceVoice {
  /** How loud what is being said is right now, from 0 to 1. */
  level(): number
}

/**
 * Says each sentence through the speech engine and the speakers. The next sentence is made while this one
 * plays, so there is no gap between them. When the engine fails, the sentence is held silent for the time it
 * would take to read, so the caption keeps its pace.
 */
export function engineVoice(engine: SpeechEngine, style: () => string, fallbackLanguage = 'en'): SpeakingVoice {
  let context: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let buffer: Float32Array<ArrayBuffer> | undefined
  /** Sound being made ahead, by sentence text. */
  const ahead = new Map<string, Promise<AudioBuffer | undefined>>()

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

  const make = (text: string, language: string | undefined) => {
    const known = ahead.get(text)
    if (known) return known
    const { context: audio } = ready()
    const made = engine.speak(text, { language: language ?? fallbackLanguage, style: style() }).then(
      (sound) => {
        const out = audio.createBuffer(1, sound.samples.length, sound.sampleRate)
        out.copyToChannel(new Float32Array(sound.samples), 0)
        return out
      },
      () => undefined
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
      let source: AudioBufferSourceNode | undefined
      let timer: number | undefined
      let finish: () => void = () => undefined
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      void make(sentence.text, sentence.language).then((audio) => {
        ahead.delete(sentence.text)
        if (cancelled) return finish()
        if (!audio) {
          timer = window.setTimeout(finish, Math.max(1200, sentence.text.length * 55))
          return
        }
        const { context: out, analyser: meter } = ready()
        void out.resume()
        source = out.createBufferSource()
        source.buffer = audio
        source.connect(meter)
        source.onended = () => finish()
        source.start()
      })
      return {
        done,
        cancel() {
          cancelled = true
          window.clearTimeout(timer)
          try {
            source?.stop()
          } catch {
            // It had not started, or had already ended.
          }
          finish()
        }
      }
    }
  }
}
