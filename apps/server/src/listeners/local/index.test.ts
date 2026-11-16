import { connect } from 'node:net'
import { PROTOCOL_VERSION, encodeLine } from '@repo/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import type { Core } from '../../compose.ts'
import { listenLocal, type LocalListener } from './index.ts'

/** A core that welcomes everyone, to test the listener alone. */
const welcoming: Core = {
  admit: () => ({
    admitted: true,
    hello: { type: 'hello', protocol: PROTOCOL_VERSION, client: { kind: 'desktop', version: '1', device: 'd' }, capabilities: [], credential: 'c' },
    reply: { type: 'welcome', protocol: PROTOCOL_VERSION, core: { version: '1' } }
  })
}

let listener: LocalListener | undefined
afterEach(async () => {
  await listener?.close()
  listener = undefined
})

/** Resolves with how long the core kept a connection that did `say`, once the core hangs up. */
function untilHungUp(address: string, say?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const socket = connect(address)
    socket.once('connect', () => say !== undefined && socket.write(say))
    socket.on('error', reject)
    socket.on('data', () => undefined)
    socket.on('close', () => resolve(Date.now() - started))
  })
}

describe('listenLocal', () => {
  it('disconnects a client that stays silent', async () => {
    listener = await listenLocal(welcoming, { handshakeTimeoutMs: 50 })
    const kept = await untilHungUp(listener.address)
    expect(kept).toBeGreaterThanOrEqual(40)
    expect(kept).toBeLessThan(2000)
  })

  it('keeps a client that said hello past the time allowed for the handshake', async () => {
    listener = await listenLocal(welcoming, { handshakeTimeoutMs: 50 })
    let hungUp = false
    void untilHungUp(listener.address, encodeLine({ type: 'hello' })).then(() => (hungUp = true))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(hungUp).toBe(false)
  })

  it('disconnects its clients when it closes', async () => {
    listener = await listenLocal(welcoming)
    const hungUp = untilHungUp(listener.address, encodeLine({ type: 'hello' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    await listener.close()
    listener = undefined
    await hungUp
  })
})
