import { describe, expect, it } from 'vitest'
import { onPortMessage, type StarterMessage, starterMessageSchema } from './launch.ts'

describe('a message on the port between a core and its starter', () => {
  it.each([
    { received: { type: 'token', token: 'secret' }, handled: [{ type: 'token', token: 'secret' }] },
    { received: { type: 'token', token: '' }, handled: [{ type: 'token', token: '' }] },
    { received: { type: 'token' }, handled: [] },
    { received: { type: 'token', token: 7 }, handled: [] },
    { received: { type: 'something-newer' }, handled: [] },
    { received: 'token', handled: [] },
    { received: null, handled: [] }
  ])('gives $received to the handler of its type, if any', ({ received, handled }) => {
    const given: StarterMessage[] = []
    onPortMessage(starterMessageSchema, { token: (message) => given.push(message) })(received)
    expect(given).toEqual(handled)
  })
})
