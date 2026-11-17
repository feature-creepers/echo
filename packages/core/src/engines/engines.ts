import type { Engines, HarnessState } from '@repo/protocol'
import type { Harness } from '../ports/harness.ts'

/** The harnesses on this machine: which can be used, and the one the assistant runs on. */
export interface EngineRoom {
  /** Where each harness stands. Looked up once and remembered; `refresh` looks again. */
  read(refresh?: boolean): Promise<Engines>
  /** The harness to run on: the first that is installed and signed in. Nothing when none is. */
  active(): Promise<Harness | undefined>
  /** Open a harness's own sign-in. Rejects when there is no harness of that name. */
  signIn(id: string): Promise<void>
  /** Be told each time a look gives something different. Returns a function that stops the telling. */
  onChange(listener: (engines: Engines) => void): () => void
}

const usable = (state: HarnessState) => state.installed && state.signedIn && state.problem === undefined

/**
 * Harnesses are tried in the order given, which is the order of preference.
 * Looking at a harness runs its program, which is slow, so the answer is kept until someone asks to look again.
 */
export function createEngineRoom(harnesses: readonly Harness[]): EngineRoom {
  let known: Promise<Engines> | undefined
  let last: string | undefined
  const listeners = new Set<(engines: Engines) => void>()

  const look = async (): Promise<Engines> => {
    const states = await Promise.all(
      harnesses.map(async (harness): Promise<HarnessState> => {
        try {
          return { id: harness.id, name: harness.name, ...(await harness.status()) }
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error)
          return { id: harness.id, name: harness.name, installed: false, signedIn: false, problem }
        }
      })
    )
    const active = states.find(usable)?.id
    const engines: Engines = active === undefined ? { harnesses: states } : { harnesses: states, active }
    const fingerprint = JSON.stringify(engines)
    if (last !== undefined && last !== fingerprint) for (const listener of listeners) listener(engines)
    last = fingerprint
    return engines
  }

  const read = (refresh = false) => {
    if (refresh || !known) known = look()
    return known
  }

  return {
    read,
    async active() {
      const { active } = await read()
      return harnesses.find((harness) => harness.id === active)
    },
    async signIn(id) {
      const harness = harnesses.find((candidate) => candidate.id === id)
      if (!harness) throw new Error(`There is no harness "${id}".`)
      await harness.signIn()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
