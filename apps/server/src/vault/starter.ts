import { randomUUID } from 'node:crypto'
import type { Keeping } from '@repo/core'
import { type VaultAnswer, type VaultRequest, vaultAnswerSchema } from '@repo/protocol'

/**
 * The program that started the core, as the vault reaches it: it seals and opens with the system's own store, which
 * only it can reach. An Electron utility process talks to it over its parent port (`process.parentPort`).
 */
export interface Sealer {
  keeping(): Promise<Keeping>
  /** The text, sealed, in base 64. */
  seal(text: string): Promise<string>
  /** The text sealed in base 64, opened; `stale` when the system wants it sealed again. */
  open(sealed: string): Promise<{ text: string; stale: boolean }>
}

/** The parent port of an Electron utility process, as far as the vault uses it. */
export interface ParentPort {
  on(event: 'message', listener: (message: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

/** How long the starter has to answer: the system may ask the person first, as macOS asks to use a Keychain item. */
const ANSWER_MS = 120_000

/** The starter's sealer, over the parent port. */
export function starterSealer(port: ParentPort): Sealer {
  const waiting = new Map<string, (answer: VaultAnswer) => void>()
  port.on('message', ({ data }) => {
    const answer = vaultAnswerSchema.safeParse(data)
    if (!answer.success) return
    waiting.get(answer.data.id)?.(answer.data)
    waiting.delete(answer.data.id)
  })

  const ask = (op: VaultRequest['op'], text?: string) =>
    new Promise<VaultAnswer>((resolve) => {
      const id = randomUUID()
      const late = setTimeout(() => {
        waiting.delete(id)
        resolve({ type: 'vault', id, ok: false, reason: 'The app did not answer in time.' })
      }, ANSWER_MS)
      late.unref()
      waiting.set(id, (answer) => {
        clearTimeout(late)
        resolve(answer)
      })
      const request: VaultRequest = { type: 'vault', id, op, ...(text === undefined ? {} : { text }) }
      port.postMessage(request)
    })
  const failed = (answer: VaultAnswer) => new Error(answer.reason ?? 'The system store refused.')

  return {
    async keeping() {
      const answer = await ask('keeping')
      return answer.ok ? { kept: true } : { kept: false, reason: answer.reason ?? 'Sign-ins cannot be kept safely on this computer.' }
    },
    async seal(text) {
      const answer = await ask('seal', text)
      if (!answer.ok || answer.text === undefined) throw failed(answer)
      return answer.text
    },
    async open(sealed) {
      const answer = await ask('open', sealed)
      if (!answer.ok || answer.text === undefined) throw failed(answer)
      return { text: answer.text, stale: answer.stale === true }
    }
  }
}

/** The starter's sealer, when the core was started as a utility process: otherwise nothing, and secrets stay in memory. */
export function sealerOfStarter(): Sealer | undefined {
  const port = (process as { parentPort?: ParentPort }).parentPort
  return port ? starterSealer(port) : undefined
}
