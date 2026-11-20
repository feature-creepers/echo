import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Vault } from '@repo/accounts'
import type { Keeping } from '@repo/core'
import { z } from 'zod'
import type { Sealer } from './starter.ts'

/**
 * The vault (docs/SPEC.md, section 12.4, item 4): secrets sealed by the program that started the core, kept in
 * `<data>/vault.json` as a map from a name to the sealed bytes in base 64, written whole or not at all. It never holds
 * a secret in clear on disk. The data folder is never reached by a session (section 12.2).
 *
 * When nothing can be kept safely (no starter to seal, or a system store that protects nothing), entries are kept in
 * memory only, until the core stops, and `keeping` says why.
 */

const NO_STARTER: Keeping = {
  kept: false,
  reason: 'This core runs on its own, with no app to seal sign-ins with the system’s store: they last until it stops.'
}

const fileSchema = z.record(z.string(), z.string())

export function openVault({ file, sealer }: { file: string; sealer: Sealer | undefined }): Vault {
  let keeping: Promise<Keeping> | undefined
  const keepingHere = () => {
    keeping ??= sealer ? sealer.keeping().catch((error: unknown) => ({ kept: false, reason: String(error) })) : Promise.resolve(NO_STARTER)
    return keeping
  }
  const memory = new Map<string, string>()

  /** Changes to the file, one after the other, so none is lost. */
  let queue: Promise<unknown> = Promise.resolve()
  const change = <Result>(work: () => Promise<Result>): Promise<Result> => {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }

  const load = async (): Promise<Record<string, string>> => {
    const text = await readFile(file, 'utf8').catch(() => undefined)
    if (text === undefined) return {}
    try {
      const read = fileSchema.safeParse(JSON.parse(text))
      return read.success ? read.data : {}
    } catch {
      return {}
    }
  }

  const save = async (entries: Record<string, string>) => {
    const fresh = `${file}.new`
    await writeFile(fresh, JSON.stringify(entries), { mode: 0o600 })
    await rename(fresh, file)
  }

  return {
    keeping: keepingHere,

    async read(name) {
      if (!sealer || !(await keepingHere()).kept) return memory.get(name)
      const sealed = (await load())[name]
      if (sealed === undefined) return undefined
      const opened = await sealer.open(sealed)
      if (opened.stale) {
        const again = await sealer.seal(opened.text)
        await change(async () => save({ ...(await load()), [name]: again }))
      }
      return opened.text
    },

    async write(name, text) {
      if (!sealer || !(await keepingHere()).kept) {
        memory.set(name, text)
        return
      }
      const sealed = await sealer.seal(text)
      await change(async () => save({ ...(await load()), [name]: sealed }))
    },

    async erase(name) {
      memory.delete(name)
      if (!sealer || !(await keepingHere()).kept) return
      await change(async () => {
        const entries = await load()
        if (!(name in entries)) return
        delete entries[name]
        await save(entries)
      })
    }
  }
}
