import type { Event, Exchange } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../session.ts'
import { followChannel } from './channel.ts'

function line(turn: string, changes: Partial<Exchange> = {}): Exchange {
  return { turn, at: '2026-11-17T08:00:00.000Z', persona: 'first', said: `said ${turn}`, replied: '', outcome: 'running', ...changes }
}

/** A session whose core is the test. */
function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  const ran: { name: string; input: unknown }[] = []
  let answerRead: (exchanges: Exchange[]) => void = () => undefined
  const session: Session = {
    run: (name, input) => {
      ran.push({ name, input })
      if (name === 'channel.read') {
        return new Promise<never>((resolve) => {
          answerRead = (exchanges) => resolve({ exchanges } as never)
        })
      }
      return Promise.resolve({} as never)
    },
    onEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => undefined
  }
  const emit = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  return { session, emit, ran, answerRead: (exchanges: Exchange[]) => answerRead(exchanges), listening: () => listeners.size }
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('followChannel', () => {
  it('starts with the transcript the core holds', async () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    expect(channel.current()).toEqual({ exchanges: [], running: undefined })

    core.answerRead([line('t1', { replied: 'Hello.', outcome: 'done' })])
    await settled()

    expect(channel.current().exchanges.map((exchange) => exchange.turn)).toEqual(['t1'])
    expect(channel.current().running).toBeUndefined()
  })

  it('follows a turn from its start to its end, sentence by sentence', () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    const changed = vi.fn()
    channel.subscribe(changed)

    core.emit({ type: 'event', name: 'turn.started', exchange: line('t1') })
    expect(channel.current().running).toBe('t1')

    core.emit({ type: 'event', name: 'speech.say', turn: 't1', text: 'A risotto would work.' })
    core.emit({ type: 'event', name: 'speech.say', turn: 't1', text: 'Forty minutes.' })
    expect(channel.current().exchanges[0]?.replied).toBe('A risotto would work. Forty minutes.')

    core.emit({ type: 'event', name: 'turn.ended', exchange: line('t1', { replied: 'A risotto would work. Forty minutes.', outcome: 'done' }) })
    expect(channel.current()).toEqual({ exchanges: [line('t1', { replied: 'A risotto would work. Forty minutes.', outcome: 'done' })], running: undefined })
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('leaves out of the conversation what a thread hands its sub-threads', () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    core.emit({ type: 'event', name: 'turn.started', exchange: line('t1') })
    core.emit({ type: 'event', name: 'turn.started', exchange: line('t2', { thread: 'sub', trigger: 'delegated' }) })
    core.emit({ type: 'event', name: 'turn.ended', exchange: line('t2', { thread: 'sub', trigger: 'delegated', outcome: 'done' }) })

    expect(channel.current()).toEqual({ exchanges: [line('t1')], running: 't1' })
  })

  it('gives each sentence to say, with its language', () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    const heard = vi.fn()
    const stop = channel.onSentence(heard)

    core.emit({ type: 'event', name: 'turn.started', exchange: line('t1') })
    core.emit({ type: 'event', name: 'speech.say', turn: 't1', text: 'Bonjour.', language: 'fr' })
    stop()
    core.emit({ type: 'event', name: 'speech.say', turn: 't1', text: 'Encore.' })

    expect(heard).toHaveBeenCalledExactlyOnceWith({ turn: 't1', text: 'Bonjour.', language: 'fr' })
  })

  it('says when a turn was stopped or failed, and not when it simply ended', () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    const stopped = vi.fn()
    channel.onStopped(stopped)

    core.emit({ type: 'event', name: 'turn.ended', exchange: line('t1', { outcome: 'done' }) })
    core.emit({ type: 'event', name: 'turn.ended', exchange: line('t2', { outcome: 'stopped' }) })
    core.emit({ type: 'event', name: 'turn.ended', exchange: line('t3', { outcome: 'failed', problem: 'No.' }) })

    expect(stopped.mock.calls).toEqual([['t2'], ['t3']])
  })

  it('keeps what events said while the read was on its way', async () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    core.emit({ type: 'event', name: 'turn.started', exchange: line('t2') })
    core.emit({ type: 'event', name: 'speech.say', turn: 't2', text: 'Newer.' })

    core.answerRead([line('t1', { outcome: 'done' }), line('t2')])
    await settled()

    expect(channel.current().exchanges.map((exchange) => [exchange.turn, exchange.replied])).toEqual([
      ['t1', ''],
      ['t2', 'Newer.']
    ])
    expect(channel.current().running).toBe('t2')
  })

  it('sends what the user says, and the order to stop', async () => {
    const core = fakeSession()
    const channel = followChannel(core.session)

    await channel.say('Hello')
    await channel.say('Bonjour', 'fr')
    await channel.say('And tomorrow?', 'en', undefined, true, false)
    await channel.stop()

    expect(core.ran.slice(1)).toEqual([
      { name: 'utterance.send', input: { text: 'Hello' } },
      { name: 'utterance.send', input: { text: 'Bonjour', language: 'fr' } },
      { name: 'utterance.send', input: { text: 'And tomorrow?', language: 'en', spoken: true, screen: false } },
      { name: 'turn.stop', input: {} }
    ])
  })

  it('hears nothing more once it stops following', () => {
    const core = fakeSession()
    const channel = followChannel(core.session)
    channel.unfollow()
    core.emit({ type: 'event', name: 'turn.started', exchange: line('t1') })

    expect(channel.current().exchanges).toEqual([])
    expect(core.listening()).toBe(0)
  })
})
