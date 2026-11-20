import type { AudioDevice } from '@repo/client'
import { useEffect, useState } from 'react'
import { microphoneProblem, openMicrophone } from './devices.ts'

/** What the meter hears. */
export type Hearing =
  | { is: 'opening' }
  /** `level` from 0 to 1 on a meter's scale; `heard` once anything louder than a microphone's own hiss came in. */
  | { is: 'open'; level: number; heard: boolean; silent: boolean }
  | { is: 'failed'; problem: string }

/** Below this, a microphone gives digital silence: a real one always hisses a little. */
const SILENT_PEAK = 1e-4
/** Louder than this is a voice, or at least a sound. */
const HEARD_PEAK = 0.02
/** How long digital silence lasts before the meter says so. */
const SILENT_AFTER_MS = 2500

/** Amplitude to a meter's 0 to 1, over 60 decibels, as a mixing desk shows it. */
function meterLevel(rms: number): number {
  if (rms <= 0) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60))
}

/**
 * The live level of a microphone, while the component using it is shown: so the person sees that it hears
 * them before they talk to the assistant. The microphone is closed as soon as it is not shown.
 */
export function useLevel(microphone: AudioDevice): Hearing {
  const [hearing, setHearing] = useState<Hearing>({ is: 'opening' })
  // Opened again when the device chosen changes, not each time the settings around it do.
  const { id, label } = microphone

  useEffect(() => {
    let stopped = false
    let frame = 0
    let release: () => void = () => undefined
    setHearing({ is: 'opening' })
    openMicrophone({ id, label })
      .then((stream) => {
        if (stopped) {
          for (const track of stream.getTracks()) track.stop()
          return
        }
        const context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        context.createMediaStreamSource(stream).connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        const opened = performance.now()
        let heard = false
        let loudest = 0
        let shown = 0
        const tick = () => {
          analyser.getFloatTimeDomainData(samples)
          let sum = 0
          let peak = 0
          for (const sample of samples) {
            sum += sample * sample
            peak = Math.max(peak, Math.abs(sample))
          }
          loudest = Math.max(loudest, peak)
          heard ||= peak > HEARD_PEAK
          // Falls back slowly, as a meter's needle does, so a word is seen rather than flickered.
          shown = Math.max(meterLevel(Math.sqrt(sum / samples.length)), shown * 0.9)
          const silent = loudest < SILENT_PEAK && performance.now() - opened > SILENT_AFTER_MS
          setHearing({ is: 'open', level: shown, heard, silent })
          frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        release = () => {
          for (const track of stream.getTracks()) track.stop()
          void context.close()
        }
      })
      .catch((error: unknown) => {
        if (!stopped) setHearing({ is: 'failed', problem: microphoneProblem(error) })
      })
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      release()
    }
  }, [id, label])

  return hearing
}
