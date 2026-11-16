import { PROTOCOL_VERSION, type Hello } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { admit, type AdmissionRules } from './admission.ts'

const rules: AdmissionRules = { coreVersion: '1.2.3', acceptsCredential: (credential) => credential === 'right' }

const hello: Hello = {
  type: 'hello',
  protocol: PROTOCOL_VERSION,
  client: { kind: 'desktop', version: '0.1.0', device: 'device-1' },
  capabilities: ['display', 'microphone'],
  credential: 'right'
}

describe('admit', () => {
  it('welcomes a client with the right protocol version and credential', () => {
    expect(admit(hello, rules)).toEqual({
      admitted: true,
      hello,
      reply: { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1.2.3' } }
    })
  })

  it('refuses a wrong credential', () => {
    expect(admit({ ...hello, credential: 'wrong' }, rules)).toEqual({
      admitted: false,
      reply: { type: 'refusal', reason: 'credential', protocol: PROTOCOL_VERSION }
    })
  })

  it('names the protocol as the problem for a client from another version, even if the rest of its hello is unreadable', () => {
    const fromTheFuture = { type: 'hello', protocol: PROTOCOL_VERSION + 1, somethingNew: true }
    expect(admit(fromTheFuture, rules)).toMatchObject({ admitted: false, reply: { reason: 'protocol', protocol: PROTOCOL_VERSION } })
  })

  it('checks the protocol before the credential', () => {
    expect(admit({ ...hello, protocol: PROTOCOL_VERSION + 1, credential: 'wrong' }, rules)).toMatchObject({ reply: { reason: 'protocol' } })
  })

  it.each([
    ['not an object', 'hello'],
    ['another message', { type: 'welcome', protocol: PROTOCOL_VERSION }],
    ['a hello with no client', { type: 'hello', protocol: PROTOCOL_VERSION, capabilities: [], credential: 'right' }],
    ['an unknown capability', { ...hello, capabilities: ['teleport'] }]
  ])('refuses %s as malformed', (_name, message) => {
    expect(admit(message, rules)).toMatchObject({ admitted: false, reply: { reason: 'malformed' } })
  })

  it('ignores fields it does not know', () => {
    expect(admit({ ...hello, addedLater: 1 }, rules).admitted).toBe(true)
  })
})
