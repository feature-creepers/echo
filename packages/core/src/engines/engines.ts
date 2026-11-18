import type { Engines, HarnessState } from '@repo/protocol'
import type { Timers } from '../ports/clock.ts'
import type { Harness, HarnessModels, OneShot, SessionRequest } from '../ports/harness.ts'

/** The harnesses on this machine: which can be used, and the one the assistant runs on. */
export interface EngineRoom {
  /** Where each harness stands. Looked up once and remembered; `refresh` looks again. */
  read(refresh?: boolean): Promise<Engines>
  /**
   * The harness to run on: the one the user prefers when it is ready, else the first that is installed and
   * signed in. Nothing when none is. Its answers use the model the user chose for it. A harness ahead of it whose
   * last look got no answer, or is old, is looked at again first.
   */
  active(): Promise<Harness | undefined>
  /** Open a harness's own sign-in. Rejects when there is no harness of that name. */
  signIn(id: string): Promise<void>
  /** The model a harness's answers run on: the user's choice while the harness offers it. Nothing for its default. */
  chosenModel(id: string): string | undefined
  /** How hard a harness's answers reason: the user's choice while the model they run on offers it. Nothing for its default. */
  chosenEffort(id: string): string | undefined
  /** The user changed their choice: decide again from the last look, without looking again. */
  reconsider(): Promise<void>
  /** Be told each time a look or a choice gives something different. Returns a function that stops the telling. */
  onChange(listener: (engines: Engines) => void): () => void
  /** Stop looking again by itself. Called once, when the core closes. */
  close(): void
}

/** What the user chose, read each time it matters, so a change applies to the next session opened. */
export interface EngineChoice {
  /** The harness to run on whenever it is ready. */
  preferred(): string | undefined
  /** The model a harness answers with, as the user chose it. */
  model(harness: string): string | undefined
  /** How hard a harness's answers reason, as the user chose it. */
  effort(harness: string): string | undefined
}

const NO_CHOICE: EngineChoice = { preferred: () => undefined, model: () => undefined, effort: () => undefined }

const usable = (state: Pick<HarnessState, 'installed' | 'signedIn' | 'problem'>) => state.installed && state.signedIn && state.problem === undefined

/** What the room needs besides the harnesses: the time, and a way to look again later. */
export interface EngineRoomOptions {
  /** The time now, in milliseconds. Left out, the machine's clock. */
  now?: () => number
  /** Runs a look again later, after one that got no answer. Left out, a harness is looked at again only when asked. */
  timers?: Timers
}

/** What a look at one harness found, before the user's choice is applied. */
interface Seen {
  state: Omit<HarnessState, 'models' | 'defaultModel' | 'model' | 'effort'>
  /** The models it offers, from this look or the last that could read them. */
  models?: HarnessModels | undefined
  /** When the look ended. */
  at: number
  /** Its program gave no answer (it did not finish in time, or could not start): a moment later it may be ready. */
  unanswered: boolean
}

/**
 * How old a look may be for the room to settle on a harness other than the one it would rather run on without
 * looking again: the person may have signed in since.
 */
export const FRESH_MS = 30_000

/** When a harness gave no answer, it is looked at again after each of these in turn, then only when something asks. */
export const RETRIES_MS = [3_000, 10_000, 30_000, 60_000] as const

/**
 * Harnesses are tried in the order given, which is the order of preference, unless the user prefers one.
 *
 * Looking at a harness runs its program, which is slow, so each look is kept until someone asks to look again, and
 * one harness is never looked at twice at once: a second look while one is under way waits for it. A look can fail
 * for a passing reason (the program slow to start with the computer, busy refreshing its sign-in), and the room never
 * gives up the harness it would rather run on for that: before it settles on another, it looks again at each one
 * ahead of it whose look got no answer or is old, and it keeps looking again at one that got no answer on its own,
 * telling the clients when it comes back.
 */
export function createEngineRoom(harnesses: readonly Harness[], choice: EngineChoice = NO_CHOICE, options: EngineRoomOptions = {}): EngineRoom {
  const clock = options.now ?? (() => Date.now())
  const seen = new Map<string, Seen>()
  const looking = new Map<string, Promise<Seen>>()
  /** The looks set to run again, by harness: how many ran so far, and how to cancel the next. */
  const retrying = new Map<string, { attempts: number; cancel?: (() => void) | undefined }>()
  let closed = false
  let last: string | undefined
  const listeners = new Set<(engines: Engines) => void>()

  /** Look at one harness, or wait for the look of it under way. */
  const lookAt = (harness: Harness): Promise<Seen> => {
    const under = looking.get(harness.id)
    if (under) return under
    const look = (async (): Promise<Seen> => {
      // How it works with files is found beside the rest, so a check it runs is done before its first session.
      const [offered, files] = await Promise.all([harness.models().catch(() => undefined), harness.computer?.().catch(() => undefined)])
      const holding = files ? { files: { confines: files.confines, needs: files.needs } } : {}
      let found: Seen
      try {
        const { unanswered, ...status } = await harness.status()
        found = { state: { id: harness.id, name: harness.name, ...status, ...holding }, at: clock(), unanswered: unanswered === true }
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error)
        found = { state: { id: harness.id, name: harness.name, installed: false, signedIn: false, problem }, at: clock(), unanswered: true }
      }
      found.models = offered ?? seen.get(harness.id)?.models
      seen.set(harness.id, found)
      looking.delete(harness.id)
      later(harness, found)
      return found
    })()
    looking.set(harness.id, look)
    return look
  }

  /** After a look that got no answer, look again by itself a while later, fewer times the longer it lasts. */
  const later = (harness: Harness, found: Seen) => {
    const retry = retrying.get(harness.id)
    retry?.cancel?.()
    if (!found.unanswered) return void retrying.delete(harness.id)
    const attempts = retry?.attempts ?? 0
    const wait = RETRIES_MS[attempts]
    if (closed || !options.timers || wait === undefined) return
    const next: { attempts: number; cancel?: (() => void) | undefined } = { attempts: attempts + 1 }
    retrying.set(harness.id, next)
    next.cancel = options.timers.after(wait, () => {
      next.cancel = undefined
      if (!closed) void lookAt(harness).then(() => decide())
    })
  }

  /** The model a harness answers with: the user's choice when the harness still offers it, else its default. */
  const answering = (id: string, offered: HarnessModels | undefined) => {
    const chosen = choice.model(id)
    return chosen !== undefined && offered?.models.some((model) => model.id === chosen) ? chosen : offered?.default
  }

  /** The level the user chose for a harness, when the model its answers run on offers it. */
  const offeredEffort = (id: string, offered: HarnessModels | undefined, model: string | undefined) => {
    const chosen = choice.effort(id)
    const efforts = offered?.models.find((one) => one.id === model)?.efforts ?? []
    return chosen !== undefined && efforts.some((effort) => effort.id === chosen) ? chosen : undefined
  }

  /** How hard a harness's answers reason: the user's choice when its model offers it, else the model's default. */
  const reasoning = (id: string, offered: HarnessModels | undefined, model: string | undefined) =>
    offeredEffort(id, offered, model) ?? offered?.models.find((one) => one.id === model)?.defaultEffort

  /** The harnesses in the order they are tried: the one the user prefers first, then the others as given. */
  const ordered = () => {
    const preferred = harnesses.find((harness) => harness.id === choice.preferred())
    return preferred ? [preferred, ...harnesses.filter((harness) => harness !== preferred)] : [...harnesses]
  }

  /** What the clients are shown: the looks with the user's choice applied. Tells the listeners when it changed. */
  const decide = (): Engines => {
    const harnessStates = harnesses.flatMap((harness): HarnessState[] => {
      const found = seen.get(harness.id)
      if (!found) return []
      const offered = found.models
      const model = answering(harness.id, offered)
      const effort = reasoning(harness.id, offered, model)
      return [
        {
          ...found.state,
          models: offered?.models ?? [],
          ...(offered ? { defaultModel: offered.default } : {}),
          ...(model === undefined ? {} : { model }),
          ...(effort === undefined ? {} : { effort })
        }
      ]
    })
    const active = ordered().find((harness) => {
      const state = harnessStates.find((candidate) => candidate.id === harness.id)
      return state !== undefined && usable(state)
    })?.id
    const engines: Engines = active === undefined ? { harnesses: harnessStates } : { harnesses: harnessStates, active }
    const fingerprint = JSON.stringify(engines)
    if (last !== undefined && last !== fingerprint) for (const listener of listeners) listener(engines)
    last = fingerprint
    return engines
  }

  const read = async (refresh = false) => {
    await Promise.all(harnesses.map((harness) => (refresh || !seen.has(harness.id) ? lookAt(harness) : looking.get(harness.id))))
    return decide()
  }

  /**
   * The harness to run on. Each one ahead of the first ready, in the order they are tried, is looked at again when
   * its last look got no answer or is old, so a passing failure never hands the work to another.
   */
  const settle = async (): Promise<Harness | undefined> => {
    await read()
    for (const harness of ordered()) {
      let found = seen.get(harness.id)
      if (found && !usable(found.state) && (found.unanswered || clock() - found.at > FRESH_MS)) found = await lookAt(harness)
      if (found && usable(found.state)) return harness
    }
    return undefined
  }

  const chosenModel = (id: string) => {
    const model = choice.model(id)
    return model !== undefined && seen.get(id)?.models?.models.some((one) => one.id === model) ? model : undefined
  }

  const chosenEffort = (id: string) => {
    const offered = seen.get(id)?.models
    return offeredEffort(id, offered, answering(id, offered))
  }

  /** Each harness as the core uses it: the same, except that its answers run on the model and the level the user chose. */
  const wrapped = new Map<string, Harness>()
  const answeringHarness = (harness: Harness): Harness => {
    const known = wrapped.get(harness.id)
    if (known) return known
    // Only the answers follow the user's choice: routing and the work done asleep stay on the fast model.
    // The room has looked by the time a harness is handed out, so the models it offers are known.
    const withModel = <Request extends SessionRequest | OneShot>(request: Request): Request => {
      if (request.role !== 'thread' || request.model !== undefined) return request
      const model = chosenModel(harness.id)
      const effort = request.effort ?? chosenEffort(harness.id)
      return { ...request, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
    }
    const made: Harness = {
      id: harness.id,
      name: harness.name,
      ...(harness.capabilities ? { capabilities: harness.capabilities } : {}),
      ...(harness.computer ? { computer: harness.computer.bind(harness) } : {}),
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
      const harness = await settle()
      decide()
      return harness ? answeringHarness(harness) : undefined
    },
    async signIn(id) {
      const harness = harnesses.find((candidate) => candidate.id === id)
      if (!harness) throw new Error(`There is no harness "${id}".`)
      await harness.signIn()
    },
    chosenModel,
    chosenEffort,
    async reconsider() {
      await Promise.all(harnesses.map((harness) => looking.get(harness.id)))
      if (harnesses.every((harness) => seen.has(harness.id))) decide()
    },
    onChange(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close() {
      closed = true
      for (const retry of retrying.values()) retry.cancel?.()
      retrying.clear()
    }
  }
}
