import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Keeping } from '@repo/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type ParentPort, type Sealer, starterSealer } from './starter.ts'
import { openVault } from './vault.ts'

const TOKEN = 'refresh-token-of-ada-1234567890'

let folder: string
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'vault-'))
})
afterEach(() => rm(folder, { recursive: true, force: true }))

/** The system's store, as a test plays it: a real cipher with a key of its own, and a seal it may want renewed. */
function systemStore(keeping: Keeping = { kept: true }) {
  const key = randomBytes(32)
  const store: Sealer & { stale: boolean } = {
    stale: false,
    keeping: async () => keeping,
    seal: async (text: string) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const sealed = Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()])
      return sealed.toString('base64')
    },
    open: async (sealed: string) => {
      const bytes = Buffer.from(sealed, 'base64')
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(-16))
      const text = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
      return { text, stale: store.stale }
    }
  }
  return store
}

const fileOf = () => join(folder, 'vault.json')
const onDisk = () => readFile(fileOf()).catch(() => Buffer.alloc(0))

describe('the vault', () => {
  it('seals a secret, opens it again, and never writes it in clear', async () => {
    const vault = openVault({ file: fileOf(), sealer: systemStore() })
    await vault.write('account:a1', TOKEN)

    expect(await vault.read('account:a1')).toBe(TOKEN)
    const bytes = await onDisk()
    expect(Object.keys(JSON.parse(bytes.toString('utf8')))).toEqual(['account:a1'])
    expect(bytes.includes(TOKEN)).toBe(false)
    expect(bytes.includes(Buffer.from(TOKEN).toString('base64'))).toBe(false)
    expect(await openVault({ file: fileOf(), sealer: systemStore() }).read('account:none')).toBeUndefined()
  })

  it('seals again an entry the system wants renewed, and keeps the new seal', async () => {
    const store = systemStore()
    const vault = openVault({ file: fileOf(), sealer: store })
    await vault.write('account:a1', TOKEN)
    const before = JSON.parse((await onDisk()).toString('utf8'))['account:a1']

    store.stale = true
    expect(await vault.read('account:a1')).toBe(TOKEN)

    const after = JSON.parse((await onDisk()).toString('utf8'))['account:a1']
    expect(after).not.toBe(before)
    store.stale = false
    expect(await vault.read('account:a1')).toBe(TOKEN)
  })

  it('erases an entry, and leaves the others', async () => {
    const vault = openVault({ file: fileOf(), sealer: systemStore() })
    await Promise.all([vault.write('account:a1', TOKEN), vault.write('account:a2', 'other')])
    await vault.erase('account:a1')

    expect(await vault.read('account:a1')).toBeUndefined()
    expect(await vault.read('account:a2')).toBe('other')
  })

  it.each([
    ['no app to seal with: the core runs on its own', undefined, 'This core runs on its own'],
    ['a system store that cannot seal', systemStore({ kept: false, reason: 'This computer’s system store cannot seal sign-ins.' }), 'cannot seal'],
    ['a keyring that protects nothing', systemStore({ kept: false, reason: 'No keyring is running on this computer.' }), 'No keyring']
  ])('keeps entries in memory only with %s, and says why', async (_case, sealer, reason) => {
    const vault = openVault({ file: fileOf(), sealer })
    await vault.write('account:a1', TOKEN)

    expect(await vault.read('account:a1')).toBe(TOKEN)
    expect(await vault.keeping()).toEqual({ kept: false, reason: expect.stringContaining(reason) })
    expect((await onDisk()).length).toBe(0)
    expect(await openVault({ file: fileOf(), sealer }).read('account:a1')).toBeUndefined()
  })
})

describe('the vault’s link to the app that started the core', () => {
  /** A parent port whose other end answers as the app does. */
  function port(answer: (request: { id: string; op: string; text?: string }) => Record<string, unknown>): ParentPort {
    let listener: (message: { data: unknown }) => void = () => undefined
    return {
      on: (_event, heard) => {
        listener = heard
      },
      postMessage: (message) => {
        const request = message as { id: string; op: string; text?: string }
        queueMicrotask(() => listener({ data: { type: 'vault', id: request.id, ...answer(request) } }))
      }
    }
  }

  it('asks the app to seal and open, each answer matched to its question', async () => {
    const sealer = starterSealer(
      port((request) =>
        request.op === 'seal'
          ? { ok: true, text: Buffer.from([...(request.text ?? '')].reverse().join('')).toString('base64') }
          : request.op === 'open'
            ? (() => {
                const text = [...Buffer.from(request.text ?? '', 'base64').toString()].reverse().join('')
                return { ok: true, text, ...(text === 'first' ? { stale: true } : {}) }
              })()
            : { ok: true }
      )
    )
    const [sealed, other] = await Promise.all([sealer.seal('first'), sealer.seal('second')])
    expect(await sealer.open(sealed)).toEqual({ text: 'first', stale: true })
    expect(await sealer.open(other)).toEqual({ text: 'second', stale: false })
    expect(await sealer.keeping()).toEqual({ kept: true })
  })

  it('takes a refusal as its reason', async () => {
    const sealer = starterSealer(port(() => ({ ok: false, reason: 'No keyring is running on this computer.' })))
    expect(await sealer.keeping()).toEqual({ kept: false, reason: 'No keyring is running on this computer.' })
    await expect(sealer.seal('x')).rejects.toThrow('No keyring')
  })
})
