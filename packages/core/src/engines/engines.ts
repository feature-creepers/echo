import type { Engines, HarnessState } from '@repo/protocol'
import type { Harness, HarnessModels, OneShot, SessionRequest } from '../ports/harness.ts'

/** The harnesses on this machine: which can be used, and the one the assistant runs on. */
export interface EngineRoom {
  /** Where each harness stands. Looked up once and remembered; `refresh` looks again. */
  read(refresh?: boolean): Promise<Engines>
  /**
   * The harness to run on: the one the user prefers when it is ready, else the first that is installed and
   * signed in. Nothing when none is. Its answers use the model the user chose for it.
   */
  active(): Promise<Harness | undefined>
  /** Open a harness's own sign-in. Rejects when there is no harness of that name. */
  signIn(id: string): Promise<void>
  /** The model a harness's answers run on: the user's choice while the harness offers it. Nothing for its default. */
  chosenModel(id: string): string | undefined
  /** The user changed their choice: decide again from the last look, without looking again. */
  reconsider(): Promise<void>
  /** Be told each time a look or a choice gives something different. Returns a function that stops the telling. */
  onChange(listener: (engines: Engines) => void): () => void
}

/** What the user chose, read each time it matters, so a change applies to the next session opened. */
export interface EngineChoice {
  /** The harness to run on whenever it is ready. */
  preferred(): string | undefined
  /** The model a harness answers with, as the user chose it. */
  model(harness: string): string | undefined
}

const NO_CHOICE: EngineChoice = { preferred: () => undefined, model: () => undefined }

const usable = (state: HarnessState) => state.installed && state.signedIn && state.problem === undefined

/** What a look found: where each harness stands and the models it offers, before the user's choice is applied. */
interface Look {
  states: Omit<HarnessState, 'models' | 'defaultModel' | 'model'>[]
  models: Map<string, HarnessModels>
}

/**
 * Harnesses are tried in the order given, which is the order of preference, unless the user prefers one.
 * Looking at a harness runs its program, which is slow, so the answer is kept until someone asks to look again.
 */
export function createEngineRoom(harnesses: readonly Harness[], choice: EngineChoice = NO_CHOICE): EngineRoom {
  let looked: Promise<Look> | undefined
  /** The last look that finished. */
  let seen: Look | undefined
  let last: string | undefined
  const listeners = new Set<(engines: Engines) => void>()

  const look = async (): Promise<Look> => {
    const models = new Map<string, HarnessModels>()
    const states = await Promise.all(
      harnesses.map(async (harness) => {
        const offered = await harness.models().catch(() => undefined)
        if (offered) models.set(harness.id, offered)
        try {
          return { id: harness.id, name: harness.name, ...(await harness.status()) }
        } catch (error) {
          const problem = error instanceof Error ? error.message : String(error)
          return { id: harness.id, name: harness.name, installed: false, signedIn: false, problem }
        }
      })
    )
    return { states, models }
  }

  /** The model a harness answers with: the user's choice when the harness still offers it, else its default. */
  const answering = (id: string, offered: HarnessModels | undefined) => {
    const chosen = choice.model(id)
    return chosen !== undefined && offered?.models.some((model) => model.id === chosen) ? chosen : offered?.default
  }

  /** What the clients are shown: the look with the user's choice applied. Tells the listeners when it changed. */
  const decide = (look: Look): Engines => {
    seen = look
    const { states, models } = look
    const harnessStates = states.map((state): HarnessState => {
      const offered = models.get(state.id)
      const model = answering(state.id, offered)
      return {
        ...state,
        models: offered?.models ?? [],
        ...(offered ? { defaultModel: offered.default } : {}),
        ...(model === undefined ? {} : { model })
      }
    })
    const preferred = harnessStates.find((state) => state.id === choice.preferred() && usable(state))
    const active = (preferred ?? harnessStates.find(usable))?.id
    const engines: Engines = active === undefined ? { harnesses: harnessStates } : { harnesses: harnessStates, active }
    const fingerprint = JSON.stringify(engines)
    if (last !== undefined && last !== fingerprint) for (const listener of listeners) listener(engines)
    last = fingerprint
    return engines
  }

  const read = async (refresh = false) => {
    if (refresh || !looked) looked = look()
    return decide(await looked)
  }

  const chosenModel = (id: string) => {
    const model = choice.model(id)
    return model !== undefined && seen?.models.get(id)?.models.some((one) => one.id === model) ? model : undefined
  }

  /** Each harness as the core uses it: the same, except that its answers run on the model the user chose. */
  const wrapped = new Map<string, Harness>()
  const answeringHarness = (harness: Harness): Harness => {
    const known = wrapped.get(harness.id)
    if (known) return known
    // Only the answers follow the user's choice: routing and the work done asleep stay on the fast model.
    // The room has looked by the time a harness is handed out, so the models it offers are known.
    const withModel = <Request extends SessionRequest | OneShot>(request: Request): Request => {
      if (request.role !== 'thread' || request.model !== undefined) return request
      const model = chosenModel(harness.id)
      return model === undefined ? request : { ...request, model }
    }
    const made: Harness = {
      id: harness.id,
      name: harness.name,
      ...(harness.capabilities ? { capabilities: harness.capabilities } : {}),
      status: () => harness.status(),
      models: () => harness.models(),
      signIn: () => harness.signIn(),
      open: (request) => harness.open(withModel(request)),
      complete: (request) => harness.complete(withModel(request))
    }
    wrapped.set(harness.id, made)
    return made
  }

  return {
    read,
    async active() {
      const { active } = await read()
      const harness = harnesses.find((candidate) => candidate.id === active)
      return harness ? answeringHarness(harness) : undefined
    },
    async signIn(id) {
      const harness = harnesses.find((candidate) => candidate.id === id)
      if (!harness) throw new Error(`There is no harness "${id}".`)
      await harness.signIn()
    },
    chosenModel,
    async reconsider() {
      if (looked) decide(await looked)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }
  }
}
