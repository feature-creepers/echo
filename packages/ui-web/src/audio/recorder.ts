import type { AudioDevice } from '@repo/client'
import { openMicrophone } from './devices.ts'
import type { Sound } from './engine.ts'

/** A take from the microphone, under way. */
export interface Take {
  /** How loud the voice is right now, from 0 to 1. */
  level(): number
  /** Stop and give what was recorded. */
  finish(): Promise<Sound>
  /** Stop and throw it away. */
  cancel(): void
}

/** The worklet that hands the samples it hears to the page. The bundler ships it as a file of the app. */
const CAPTURE = new URL('./capture-worklet.js', import.meta.url).href

/** Loudness of a block of samples, scaled so ordinary speech fills most of 0 to 1. */
export function loudness(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return Math.min(1, rms * 9)
}

/**
 * Start recording from the microphone chosen for this device, or the system's when it is gone. The system
 * asks the user's permission the first time.
 */
export async function record(microphone: AudioDevice = { id: '', label: '' }): Promise<Take> {
  const stream = await openMicrophone(microphone)
  const context = new AudioContext()
  try {
    await context.audioWorklet.addModule(CAPTURE)
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    void context.close()
    throw error
  }
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'capture')
  const blocks: Float32Array[] = []
  let current = 0
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    blocks.push(event.data)
    current = loudness(event.data)
  }
  source.connect(node)

  const stop = () => {
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    for (const track of stream.getTracks()) track.stop()
    void context.close()
  }

  return {
    level: () => current,
    async finish() {
      stop()
      const length = blocks.reduce((total, block) => total + block.length, 0)
      const samples = new Float32Array(length)
      let at = 0
      for (const block of blocks) {
        samples.set(block, at)
        at += block.length
      }
      return { sampleRate: context.sampleRate, samples }
    },
    cancel: stop
  }
}
