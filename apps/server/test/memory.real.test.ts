import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemory, type Records } from '@repo/core'
import { createClaudeCode } from '@repo/harness'
import type { Exchange } from '@repo/protocol'
import { openStore, type Store } from '@repo/store'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Sleep against the user's real Claude Code, on its cheapest model: a few exchanges go in, the assistant
 * sleeps, and the facts it should keep come out, while what came from an article does not. Then a fact
 * that is no longer true is replaced. About five short calls of the user's allowance, so it runs only when
 * asked:
 *
 *   REAL_HARNESS=1 pnpm --filter @repo/server test memory
 */
const real = process.env.REAL_HARNESS === '1'
const TIMEOUT_MS = 300_000

describe.runIf(real)('sleep on the real Claude Code', () => {
  const folders: string[] = []
  let store: Store | undefined
  const errors: string[] = []

  afterAll(() => {
    store?.close()
    for (const folder of folders) rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
  })

  const folder = () => {
    const made = mkdtempSync(join(tmpdir(), 'memory-real-'))
    folders.push(made)
    return made
  }

  let turn = 0
  // Said on Tuesday 17 November 2026, in the morning, on this machine's clock.
  const said = (records: Records, text: string, replied: string, minute: number) => {
    const exchange: Exchange = {
      turn: `turn-${++turn}`,
      at: new Date(2026, 10, 17, 9, minute).toISOString(),
      persona: 'first',
      said: text,
      replied,
      outcome: 'done'
    }
    records.append([{ type: 'channel.exchange', payload: exchange }])
  }

  it(
    'keeps what the user said about themselves, with absolute dates, and replaces what is no longer true',
    async () => {
      store = openStore({ folder: folder() })
      const log = { error: (message: string) => void errors.push(message) }
      const claude = createClaudeCode({ folder: folder(), log })
      let ids = 0
      const memory = createMemory({
        records: store.records,
        search: store.search,
        engines: { active: async () => claude },
        log,
        now: () => new Date(),
        newId: () => `fact-${++ids}`
      })

      said(store.records, "My sister Anna lives in Lyon. She's coming to visit next Friday.", "Lovely, I'll keep it in mind.", 0)
      said(store.records, "What's the weather like tomorrow?", 'I cannot check the weather right now.', 1)
      said(
        store.records,
        'Read me that article. It says the best coffee in the world comes from Ethiopia.',
        'The article says Ethiopian coffee is the finest in the world.',
        2
      )
      said(store.records, 'By the way, I prefer tea to coffee. Green tea, always.', 'Noted.', 3)
      said(store.records, "Je travaille sur un assistant vocal qui s'appelle Echo.", 'Beau projet !', 4)

      const first = memory.sleepNow()
      if (!first.ok) throw new Error(first.error.message)
      await first.done
      const learned = memory.facts().map((fact) => `${fact.kind}: ${fact.text}`)
      console.info(`After the first sleep:\n${learned.join('\n')}\n\nProfile:\n${memory.read().profile ?? '(none)'}`)

      expect(learned.some((fact) => /Anna/.test(fact) && /Lyon/.test(fact))).toBe(true)
      expect(learned.some((fact) => fact.includes('2026-11-20'))).toBe(true)
      expect(learned.some((fact) => /green tea|thé vert/i.test(fact))).toBe(true)
      expect(learned.some((fact) => /Echo/.test(fact))).toBe(true)
      expect(learned.some((fact) => /Ethiop/i.test(fact))).toBe(false)
      expect(learned.some((fact) => /weather|météo/i.test(fact))).toBe(false)
      expect(memory.read().profile).toMatch(/Anna/)

      memory.wake()
      said(store.records, 'Anna moved from Lyon to Bordeaux last month.', 'Good to know.', 30)
      const second = memory.sleepNow()
      if (!second.ok) throw new Error(second.error.message)
      await second.done
      const now = memory.facts().map((fact) => `${fact.kind}: ${fact.text}${fact.replaces ? ` (replaces ${fact.replaces})` : ''}`)
      console.info(`After the second sleep:\n${now.join('\n')}\n\nProfile:\n${memory.read().profile ?? '(none)'}`)

      expect(now.some((fact) => /Anna/.test(fact) && /Bordeaux/.test(fact))).toBe(true)
      expect(now.some((fact) => /Anna/.test(fact) && /lives in Lyon/.test(fact))).toBe(false)
      // What was learned is recalled into a later turn, with no model call.
      expect(memory.recall('When is Anna coming?')).toMatch(/Anna/)
      expect(errors).toEqual([])
      memory.close()
    },
    TIMEOUT_MS
  )
})
