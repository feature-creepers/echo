import type { VaultAnswer } from '@repo/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The system's store, as Electron reaches it, played by the test. */
const system = vi.hoisted(() => ({
  available: true,
  backend: 'gnome_libsecret' as string,
  reseal: false
}))

vi.mock('electron', () => ({
  app: { whenReady: async () => undefined },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => system.available,
    getSelectedStorageBackend: () => system.backend,
    encryptStringAsync: async (text: string) => Buffer.from(`sealed:${[...text].reverse().join('')}`),
    decryptStringAsync: async (sealed: Buffer) => ({
      result: [...sealed.toString().replace('sealed:', '')].reverse().join(''),
      shouldReEncrypt: system.reseal
    })
  }
}))

const { serveVault } = await import('./vault.ts')
const { keyringProblem } = await import('./keyring/linux.ts')

/** The core's process as the app sees it: what it sends, and what it is answered. */
function core() {
  let heard: (message: unknown) => void = () => undefined
  const answers: VaultAnswer[] = []
  const process = {
    on: (_event: 'message', listener: (message: unknown) => void) => {
      heard = listener
    },
    postMessage: (message: VaultAnswer) => void answers.push(message)
  }
  serveVault(process as never)
  const ask = async (message: unknown) => {
    const before = answers.length
    heard(message)
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(before))
    return answers.at(-1)
  }
  return { ask, answers, heard: (message: unknown) => heard(message) }
}

beforeEach(() => {
  system.available = true
  system.backend = 'gnome_libsecret'
  system.reseal = false
})

describe('the vault, on the app’s side', () => {
  it('seals a text and opens it again', async () => {
    const { ask } = core()
    const sealed = await ask({ type: 'vault', id: '1', op: 'seal', text: 'refresh-token' })
    expect(sealed).toMatchObject({ type: 'vault', id: '1', ok: true })
    expect(Buffer.from(sealed?.text ?? '', 'base64').toString()).not.toContain('refresh-token')

    expect(await ask({ type: 'vault', id: '2', op: 'open', text: sealed?.text })).toEqual({ type: 'vault', id: '2', ok: true, text: 'refresh-token' })
  })

  it('says when the system wants a text sealed again', async () => {
    const { ask } = core()
    const sealed = await ask({ type: 'vault', id: '1', op: 'seal', text: 'refresh-token' })
    system.reseal = true
    expect(await ask({ type: 'vault', id: '2', op: 'open', text: sealed?.text })).toMatchObject({ ok: true, text: 'refresh-token', stale: true })
  })

  it('refuses to seal anything, and says why, when the system cannot seal', async () => {
    system.available = false
    const { ask } = core()
    expect(await ask({ type: 'vault', id: '1', op: 'keeping' })).toMatchObject({ ok: false, reason: expect.stringContaining('cannot seal') })
    expect(await ask({ type: 'vault', id: '2', op: 'seal', text: 'x' })).toMatchObject({ ok: false })
  })

  it('answers only what is the vault’s', async () => {
    const { heard, answers } = core()
    heard({ type: 'token', id: '1' })
    heard({ type: 'vault', op: 'seal' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(answers).toEqual([])
  })
})

describe('a keyring on Linux', () => {
  it.each([
    ['basic_text', true],
    ['unknown', true],
    ['gnome_libsecret', false],
    ['kwallet5', false],
    ['kwallet6', false]
  ])('%s keeps nothing safely: %s', (backend, unsafe) => {
    system.backend = backend
    expect(keyringProblem() !== undefined).toBe(unsafe)
  })
})
