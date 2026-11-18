import type { Exchange, TurnId } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** What a client knows of the conversation. */
export interface ChannelSnapshot {
  /** The transcript, oldest first. */
  exchanges: readonly Exchange[]
  /** The turn the assistant is answering, if any. */
  running: TurnId | undefined
}

/** What goes with something said: files handed over with `handOver`, by what names them, and folders, by where they are. */
export interface Handed {
  attachments?: readonly string[]
  folders?: readonly string[]
}

/** One sentence to say aloud, as the core announced it. */
export interface Sentence {
  turn: TurnId
  text: string
  language: string | undefined
}

/** The conversation, kept current for as long as the session lasts. */
export interface ChannelState extends Followed<ChannelSnapshot> {
  /**
   * Say something to the assistant, with the files already handed over and the folders given, if any. Rejects with
   * `CommandFailed` when the core does not take it.
   */
  say(text: string, language?: string, handed?: Handed): Promise<void>
  /** The app has opened: let the assistant greet and brief the user, if it is time to. */
  greet(): Promise<void>
  /** Stop the answer under way. */
  stop(): Promise<void>
  /** Be given each sentence to say aloud, as it is announced. Returns a function that stops the giving. */
  onSentence(listener: (sentence: Sentence) => void): () => void
  /** Be told when the user or the core stopped a turn, so what is still being said can be cut. */
  onStopped(listener: (turn: TurnId) => void): () => void
  unfollow(): void
}

/**
 * Read the transcript from the core and follow the conversation: every turn that starts or ends, on this
 * device or another, changes the snapshot.
 */
export function followChannel(session: Session): ChannelState {
  const state = cell<ChannelSnapshot>({ exchanges: [], running: undefined })
  const sentences = new Set<(sentence: Sentence) => void>()
  const stops = new Set<(turn: TurnId) => void>()

  const put = (exchange: Exchange) => {
    const { exchanges } = state.current()
    const at = exchanges.findIndex((line) => line.turn === exchange.turn)
    const next = at >= 0 ? exchanges.map((line, index) => (index === at ? exchange : line)) : [...exchanges, exchange]
    // Two turns can run at once (two requests in the same words): the latest still running is the one shown.
    state.set({ exchanges: next, running: next.findLast((line) => line.outcome === 'running')?.turn })
  }

  const stopEvents = session.onEvent((event) => {
    switch (event.name) {
      case 'turn.started':
        put(event.exchange)
        return
      case 'turn.ended':
        put(event.exchange)
        if (event.exchange.outcome !== 'done') for (const listener of stops) listener(event.exchange.turn)
        return
      case 'answer.written':
        put(event.exchange)
        return
      case 'speech.say': {
        const { exchanges } = state.current()
        const line = exchanges.find((exchange) => exchange.turn === event.turn)
        // An answer said again when its thread is brought back is already in the line: only a running one grows.
        if (line?.outcome === 'running') put({ ...line, replied: line.replied ? `${line.replied} ${event.text}` : event.text })
        for (const listener of sentences) listener({ turn: event.turn, text: event.text, language: event.language })
        return
      }
    }
  })

  session.run('channel.read', {}).then(
    ({ exchanges }) => {
      // Lines that arrived as events while the read was on its way are newer than what it returns.
      const known = new Map(state.current().exchanges.map((line) => [line.turn, line]))
      const merged = exchanges.map((line) => known.get(line.turn) ?? line)
      for (const line of state.current().exchanges) if (!exchanges.some((read) => read.turn === line.turn)) merged.push(line)
      state.set({ exchanges: merged, running: merged.findLast((line) => line.outcome === 'running')?.turn })
    },
    () => undefined // The transcript stays empty; what is said from now on still shows.
  )

  return {
    current: state.current,
    subscribe: state.subscribe,
    async say(text, language, handed) {
      await session.run('utterance.send', {
        text,
        ...(language === undefined ? {} : { language }),
        ...(handed?.attachments && handed.attachments.length > 0 ? { attachments: [...handed.attachments] } : {}),
        ...(handed?.folders && handed.folders.length > 0 ? { folders: [...handed.folders] } : {})
      })
    },
    async greet() {
      await session.run('assistant.greet', {})
    },
    async stop() {
      await session.run('turn.stop', {})
    },
    onSentence(listener) {
      sentences.add(listener)
      return () => void sentences.delete(listener)
    },
    onStopped(listener) {
      stops.add(listener)
      return () => void stops.delete(listener)
    },
    unfollow() {
      stopEvents()
      sentences.clear()
      stops.clear()
    }
  }
}
