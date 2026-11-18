import type { AssistantState, FactKind, MemoryView, SleepSettings } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What the assistant knows about the user, kept current for as long as the session lasts. Nothing until the core has answered. */
export interface MemoryState extends Followed<MemoryView | undefined> {
  /** Whether the assistant is asleep, and how far its sleep's work has gone. */
  assistant: Followed<AssistantState>
  /** Whether the assistant is asleep: the main screen dims the core while it is. */
  asleep: Followed<boolean>
  /** Correct a fact. */
  edit(fact: string, text: string, kind?: FactKind): Promise<void>
  forget(fact: string): Promise<void>
  /** Choose when the assistant sleeps. What is left out keeps its value. */
  setSleep(settings: Partial<SleepSettings>): Promise<void>
  /** Keep the conversation's words for so many days, or for good with null. */
  setRetention(days: number | null): Promise<void>
  /** Put the assistant to sleep now. Its progress arrives in `assistant`. */
  sleepNow(): Promise<void>
  unfollow(): void
}

/**
 * Read what the assistant knows from the core and follow its changes, from this device or another.
 *
 * Two copies of the memory can cross on the way, one read and one announced: the later revision wins. A state
 * announced while the read was on its way is newer than the one the read returns.
 */
export function followMemory(session: Session): MemoryState {
  const memory = cell<MemoryView | undefined>(undefined)
  const assistant = cell<AssistantState>({ asleep: false })
  const asleep = cell(false)
  let heardState = false

  const accept = (view: MemoryView) => {
    const known = memory.current()
    if (known && known.revision >= view.revision) return
    memory.set(view)
  }
  const stand = (state: AssistantState) => {
    assistant.set(state)
    asleep.set(state.asleep)
  }

  const stopEvents = session.onEvent((event) => {
    if (event.name === 'memory.changed') accept(event.memory)
    else if (event.name === 'assistant.state') {
      heardState = true
      stand(event.state)
    }
  })
  session.run('memory.read', {}).then(
    ({ memory: view, state }) => {
      accept(view)
      if (!heardState) stand(state)
    },
    () => undefined
  )

  return {
    current: memory.current,
    subscribe: memory.subscribe,
    assistant: { current: assistant.current, subscribe: assistant.subscribe },
    asleep: { current: asleep.current, subscribe: asleep.subscribe },
    async edit(fact, text, kind) {
      accept((await session.run('memory.edit', kind === undefined ? { fact, text } : { fact, text, kind })).memory)
    },
    async forget(fact) {
      accept((await session.run('memory.forget', { fact })).memory)
    },
    async setSleep(settings) {
      accept((await session.run('memory.sleep-settings.set', settings)).memory)
    },
    async setRetention(days) {
      accept((await session.run('memory.retention.set', { days })).memory)
    },
    async sleepNow() {
      await session.run('memory.sleep-now', {})
    },
    unfollow: stopEvents
  }
}
