import type { SessionEvent } from '@repo/core'
import { describe, expect, it } from 'vitest'
import { recordingLog } from '../../test/sessions.ts'
import { createSessionEvents } from './events.ts'

const text = (value: string): SessionEvent => ({ type: 'text', text: value })

describe('the events of a session', () => {
  it('keeps what happens before anyone listens, and gives it in order', () => {
    const events = createSessionEvents(recordingLog())
    events.emit(text('a'))
    events.emit(text('b'))

    const heard: SessionEvent[] = []
    events.listen((event) => heard.push(event))
    events.emit(text('c'))

    expect(heard).toEqual([text('a'), text('b'), text('c')])
  })

  it('gives each event to the last listener set, once', () => {
    const events = createSessionEvents(recordingLog())
    const first: SessionEvent[] = []
    const second: SessionEvent[] = []
    events.emit(text('a'))
    events.listen((event) => first.push(event))
    events.listen((event) => second.push(event))
    events.emit(text('b'))

    expect(first).toEqual([text('a')])
    expect(second).toEqual([text('b')])
  })

  it('emits nothing after a failure', () => {
    const events = createSessionEvents(recordingLog())
    const heard: SessionEvent[] = []
    events.listen((event) => heard.push(event))
    events.emit({ type: 'failed', reason: 'It stopped.' })
    events.emit(text('late'))
    events.emit({ type: 'failed', reason: 'Again.' })

    expect(heard).toEqual([{ type: 'failed', reason: 'It stopped.' }])
    expect(events.ended).toBe(true)
  })

  it('emits nothing once silenced, not even what it kept', () => {
    const events = createSessionEvents(recordingLog())
    events.emit(text('kept'))
    events.silence()
    events.emit(text('late'))

    const heard: SessionEvent[] = []
    events.listen((event) => heard.push(event))
    expect(heard).toEqual([])
  })

  it('goes on when a listener throws, and reports it', () => {
    const log = recordingLog()
    const events = createSessionEvents(log)
    const heard: SessionEvent[] = []
    events.listen((event) => {
      heard.push(event)
      if (event.type === 'text' && event.text === 'a') throw new Error('listener broke')
    })
    events.emit(text('a'))
    events.emit(text('b'))

    expect(heard).toEqual([text('a'), text('b')])
    expect(log.errors).toEqual(['A session event of type "text" could not be handled: listener broke'])
  })
})
