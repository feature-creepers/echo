import type { TurnId } from '@repo/protocol'
import type { ChannelState, Sentence } from './state/channel.ts'
import { cell, type Followed } from './state/followed.ts'

/**
 * How a device says a sentence aloud. The app supplies it: a local voice engine, the system's voice, or
 * nothing but a pause the length of the sentence when there is no sound.
 */
export interface DeviceVoice {
  /** Start saying a sentence. `done` resolves when it has been said, or when it was cancelled. */
  say(sentence: Sentence): { done: Promise<void>; cancel(): void }
}

/** What is being said right now. */
export interface Speaking {
  /** The sentence being said, which is also the caption to show. Nothing when silent. */
  sentence: Sentence | undefined
  /** Sentences announced and not yet said. */
  waiting: number
}

export interface SpeechPlayer extends Followed<Speaking> {
  /** Cut what is being said and forget what was waiting. */
  stop(): void
  /** Use another voice from the next sentence on. */
  use(voice: DeviceVoice): void
  close(): void
}

/**
 * Says the sentences of the conversation one at a time, in the order announced, through the device's voice.
 * A turn that is stopped is cut at once, and so is everything said when the user starts a new turn.
 */
export function playSpeech(channel: ChannelState, initial: DeviceVoice): SpeechPlayer {
  const state = cell<Speaking>({ sentence: undefined, waiting: 0 })
  const queue: Sentence[] = []
  let voice = initial
  let playing: { sentence: Sentence; cancel(): void } | undefined

  const publish = () => state.set({ sentence: playing?.sentence, waiting: queue.length })

  const next = () => {
    if (playing) return
    const sentence = queue.shift()
    if (!sentence) return publish()
    const saying = voice.say(sentence)
    const mine = { sentence, cancel: saying.cancel }
    playing = mine
    publish()
    void saying.done.finally(() => {
      if (playing !== mine) return
      playing = undefined
      next()
    })
  }

  const drop = (keep: (sentence: Sentence) => boolean) => {
    for (let index = queue.length - 1; index >= 0; index--) {
      const sentence = queue[index]
      if (sentence && !keep(sentence)) queue.splice(index, 1)
    }
    if (playing && !keep(playing.sentence)) {
      const stopped = playing
      playing = undefined
      stopped.cancel()
    }
    next()
    publish()
  }

  const stopSentences = channel.onSentence((sentence) => {
    // A new turn's first sentence replaces whatever an earlier turn was still saying.
    if (playing && playing.sentence.turn !== sentence.turn) drop((kept) => kept.turn === sentence.turn)
    queue.push(sentence)
    next()
    publish()
  })
  const stopStops = channel.onStopped((turn: TurnId) => drop((sentence) => sentence.turn !== turn))

  return {
    current: state.current,
    subscribe: state.subscribe,
    stop: () => drop(() => false),
    use(replacement) {
      voice = replacement
    },
    close() {
      stopSentences()
      stopStops()
      drop(() => false)
    }
  }
}
