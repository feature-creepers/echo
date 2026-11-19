import { describe, expect, it } from 'vitest'
import { favouring, type Sound, type SpeechEngine } from './engine.ts'

describe('hearing with the person’s own words', () => {
  const heardWith: (readonly string[] | undefined)[] = []
  const engine: SpeechEngine = {
    status: async () => ({ ready: true, models: [] }),
    install: async () => undefined,
    transcribe: async (_sound, words) => {
      heardWith.push(words)
      return { text: 'heard' }
    },
    speak: async () => ({ sampleRate: 16_000, samples: new Float32Array() }),
    styles: async () => []
  }
  const sound: Sound = { sampleRate: 16_000, samples: new Float32Array(4) }

  it('gives the words as they stand at each utterance, unless words are given', async () => {
    let words: readonly string[] = ['Barbanneau']
    const hearing = favouring(engine, () => words)
    await hearing.transcribe(sound)
    words = ['Barbanneau', 'Kerjean']
    await hearing.transcribe(sound)
    await hearing.transcribe(sound, [])
    expect(heardWith).toEqual([['Barbanneau'], ['Barbanneau', 'Kerjean'], []])
    expect(await hearing.styles()).toEqual([])
  })
})
