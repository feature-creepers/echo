import { describe, expect, it } from 'vitest'
import { type DeviceVoice, playSpeech } from './speech-player.ts'
import type { ChannelState, Sentence } from './state/channel.ts'

/** A channel whose core is the test: it announces the sentences and the stops it is given. */
function fakeChannel() {
  const sentences = new Set<(sentence: Sentence) => void>()
  const stops = new Set<(turn: string) => void>()
  const channel = {
    onSentence: (listener: (sentence: Sentence) => void) => {
      sentences.add(listener)
      return () => void sentences.delete(listener)
    },
    onStopped: (listener: (turn: string) => void) => {
      stops.add(listener)
      return () => void stops.delete(listener)
    }
  } as ChannelState
  const announce = (turn: string, text: string) => {
    for (const listener of sentences) listener({ turn, text, language: undefined })
  }
  const stop = (turn: string) => {
    for (const listener of stops) listener(turn)
  }
  return { channel, announce, stop, listening: () => sentences.size + stops.size }
}

/** A voice the test finishes by hand. */
function fakeVoice() {
  const said: { text: string; finish(): void; cancelled: boolean }[] = []
  const voice: DeviceVoice = {
    say(sentence) {
      let finish: () => void = () => undefined
      const done = new Promise<void>((resolve) => {
        finish = resolve
      })
      const entry = { text: sentence.text, finish, cancelled: false }
      said.push(entry)
      return {
        done,
        cancel() {
          entry.cancelled = true
          finish()
        }
      }
    }
  }
  return { voice, said }
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('the speech player', () => {
  it('says the sentences one at a time, in the order announced', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    const player = playSpeech(core.channel, voice)

    core.announce('t1', 'One.')
    core.announce('t1', 'Two.')
    expect(said.map((entry) => entry.text)).toEqual(['One.'])
    expect(player.current()).toMatchObject({ sentence: { text: 'One.' }, waiting: 1 })

    said[0]?.finish()
    await settled()
    expect(said.map((entry) => entry.text)).toEqual(['One.', 'Two.'])
    expect(player.current()).toMatchObject({ sentence: { text: 'Two.' }, waiting: 0 })

    said[1]?.finish()
    await settled()
    expect(player.current()).toEqual({ sentence: undefined, waiting: 0 })
  })

  it('cuts what it is saying and forgets the rest when told to stop', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    const player = playSpeech(core.channel, voice)
    core.announce('t1', 'One.')
    core.announce('t1', 'Two.')

    player.stop()
    await settled()

    expect(said.map((entry) => [entry.text, entry.cancelled])).toEqual([['One.', true]])
    expect(player.current()).toEqual({ sentence: undefined, waiting: 0 })
  })

  it('cuts a turn that was stopped, and only that turn', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    playSpeech(core.channel, voice)
    core.announce('t1', 'One.')
    core.announce('t1', 'Two.')

    core.stop('t2')
    expect(said[0]?.cancelled).toBe(false)

    core.stop('t1')
    await settled()
    expect(said.map((entry) => [entry.text, entry.cancelled])).toEqual([['One.', true]])
  })

  it('lets a new turn replace what an earlier one was still saying', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    const player = playSpeech(core.channel, voice)
    core.announce('t1', 'Old one.')
    core.announce('t1', 'Old two.')

    core.announce('t2', 'New.')
    await settled()

    expect(said.map((entry) => [entry.text, entry.cancelled])).toEqual([
      ['Old one.', true],
      ['New.', false]
    ])
    expect(player.current()).toMatchObject({ sentence: { text: 'New.' }, waiting: 0 })
  })

  it('uses another voice from the next sentence on', async () => {
    const core = fakeChannel()
    const first = fakeVoice()
    const second = fakeVoice()
    const player = playSpeech(core.channel, first.voice)
    core.announce('t1', 'One.')
    core.announce('t1', 'Two.')

    player.use(second.voice)
    first.said[0]?.finish()
    await settled()

    expect(first.said.map((entry) => entry.text)).toEqual(['One.'])
    expect(second.said.map((entry) => entry.text)).toEqual(['Two.'])
  })

  it('goes silent and stops listening when closed', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    const player = playSpeech(core.channel, voice)
    core.announce('t1', 'One.')

    player.close()
    core.announce('t1', 'Two.')
    await settled()

    expect(said.map((entry) => [entry.text, entry.cancelled])).toEqual([['One.', true]])
    expect(core.listening()).toBe(0)
  })
})
