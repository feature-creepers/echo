import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Session } from '../session.ts'
import { followActivity } from './activity.ts'

function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  const session = {
    onEvent: (listener: (event: Event) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  } as unknown as Session
  const send = (event: Event) => {
    for (const listener of listeners) listener(event)
  }
  return { session, send }
}

const activity = (phase: 'started' | 'ended', call: string, tool: string): Event => ({
  type: 'event',
  name: 'activity',
  turn: 't1',
  tool,
  phase,
  step: { call, turn: 't1', tool, at: '2026-11-17T08:00:00Z' }
})

describe('the activity', () => {
  it('follows the calls under way, the latest last, and forgets them when the turn ends', () => {
    const { session, send } = fakeSession()
    const followed = followActivity(session)
    send(activity('started', 'c1', 'web_search'))
    // Reported again once its input is written: still one call.
    send(activity('started', 'c1', 'web_search'))
    send(activity('started', 'c2', 'web_read'))
    expect(followed.current().running.map((step) => step.tool)).toEqual(['web_search', 'web_read'])
    send(activity('ended', 'c2', 'web_read'))
    expect(followed.current().running.map((step) => step.tool)).toEqual(['web_search'])
    send({ type: 'event', name: 'turn.ended', exchange: { turn: 't1', at: '', persona: 'p', said: 'hi', replied: '', outcome: 'done' } })
    expect(followed.current()).toEqual({ turn: undefined, running: [] })
    followed.unfollow()
  })
})
