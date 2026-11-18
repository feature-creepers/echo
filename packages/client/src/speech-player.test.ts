import type { Exchange } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { type DeviceVoice, playSpeech } from './speech-player.ts'
import type { ChannelState, Sentence } from './state/channel.ts'

/** A channel whose core is the test: it announces the sentences and the stops it is given. */
function fakeChannel() {
  const sentences = new Set<(sentence: Sentence) => void>()
  const stops = new Set<(turn: string) => void>()
  const exchanges: Exchange[] = []
  const channel = {
    current: () => ({ exchanges, running: undefined }),
    onSentence: (listener: (sentence: Sentence) => void) => {
      sentences.add(listener)
      return () => void sentences.delete(listener)
    },
    onStopped: (listener: (turn: string) => void) => {
      stops.add(listener)
      return () => void stops.delete(listener)
    }
  } as Pick<ChannelState, 'current' | 'onSentence' | 'onStopped'> as ChannelState
  const announce = (turn: string, text: string) => {
    for (const listener of sentences) listener({ turn, text, language: undefined })
  }
  const stop = (turn: string) => {
    for (const listener of stops) listener(turn)
  }
  /** A turn the assistant started itself, as the core announces it before its sentences. */
  const startedByItself = (turn: string, trigger: Exchange['trigger']) =>
    exchanges.push({ turn, at: '', persona: 'first', said: '', replied: '', outcome: 'running', ...(trigger ? { trigger } : {}) })
  return { channel, announce, stop, startedByItself, listening: () => sentences.size + stops.size }
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
    expect(player.current()).toEqual({ sentence: undefined, waiting: 0, paused: false })
  })

  it('says a reminder after the answer being said, rather than cut it, and lets the person cut it', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    playSpeech(core.channel, voice)
    core.announce('t1', 'The answer.')
    core.startedByItself('r1', 'reminder')
    core.announce('r1', 'Time to stretch.')
    expect(said.map((entry) => [entry.text, entry.cancelled])).toEqual([['The answer.', false]])

    said[0]?.finish()
    await settled()
    expect(said.map((entry) => entry.text)).toEqual(['The answer.', 'Time to stretch.'])
    // The person speaks: their turn takes the floor.
    core.announce('t2', 'Yes?')
    expect(said[1]?.cancelled).toBe(true)
    expect(said.at(-1)?.text).toBe('Yes?')
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
    expect(player.current()).toEqual({ sentence: undefined, waiting: 0, paused: false })
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

  it('holds the next sentences while paused, and carries on when resumed', async () => {
    const core = fakeChannel()
    const { voice, said } = fakeVoice()
    const player = playSpeech(core.channel, voice)
    core.announce('t1', 'One.')
    core.announce('t1', 'Two.')

    player.pause()
    said[0]?.finish()
    await settled()
    expect(said.map((entry) => entry.text)).toEqual(['One.'])
    expect(player.current()).toMatchObject({ paused: true, waiting: 1 })

    player.resume()
    await settled()
    expect(said.map((entry) => entry.text)).toEqual(['One.', 'Two.'])
    expect(player.current()).toMatchObject({ paused: false, sentence: { text: 'Two.' } })
  })
})

describe('the caption', () => {
  it('shows a sentence when its sound starts, not when it is announced, and prepares the ones after it', async () => {
    const core = fakeChannel()
    const prepared: string[] = []
    const starts: ((seconds: number) => void)[] = []
    const voice: DeviceVoice = {
      say() {
        let start: (seconds: number) => void = () => undefined
        const heard = new Promise<number | undefined>((resolve) => {
          start = resolve
        })
        starts.push(start)
        return { done: new Promise<void>(() => undefined), cancel: () => undefined, heard }
      },
      prepare: (sentence) => void prepared.push(sentence.text)
    }
    let clock = 1000
    const player = playSpeech(core.channel, voice, () => clock)
    core.announce('t1', 'First.')
    core.announce('t1', 'Second.')
    core.announce('t1', 'Third.')

    // Its sound is being made: nothing is shown yet, and everything waits.
    expect(player.current()).toMatchObject({ sentence: undefined, waiting: 3 })
    expect(prepared).toEqual(['Second.', 'Third.'])

    clock = 1450
    starts[0]?.(2.5)
    await settled()
    expect(player.current()).toMatchObject({ sentence: { text: 'First.' }, since: 1450, seconds: 2.5, waiting: 2 })
    player.close()
  })
})
