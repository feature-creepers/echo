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

/** The worklet that hands the samples it hears to the page, a block at a time. Written here so it ships inside the app. */
const CAPTURE = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('capture', Capture)
`

/** Loudness of a block of samples, scaled so ordinary speech fills most of 0 to 1. */
export function loudness(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  return Math.min(1, rms * 9)
}

/**
 * Start recording from the default microphone. The system asks the user's permission the first time.
 * Echo cancellation keeps the assistant's own voice out of what is heard.
 */
export async function record(): Promise<Take> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  })
  const context = new AudioContext()
  const url = URL.createObjectURL(new Blob([CAPTURE], { type: 'application/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
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
