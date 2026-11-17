import type { TurnId } from '@repo/protocol'
import type { ChannelState, Sentence } from './state/channel.ts'
import { cell, type Followed } from './state/followed.ts'

/**
 * How a device says a sentence aloud. The app supplies it: a local voice engine, the system's voice, or
 * nothing but a pause the length of the sentence when there is no sound.
 */
export interface DeviceVoice {
  /**
   * Start saying a sentence. `done` resolves when it has been said, or when it was cancelled. `heard` resolves
   * when its sound actually starts, with how long it lasts, in seconds: a voice makes the sound first, and the
   * caption waits for it. A voice that leaves it out is heard at once.
   */
  say(sentence: Sentence): { done: Promise<void>; cancel(): void; heard?: Promise<number | undefined> }
  /** Start making the sound of a sentence that will be said soon, so it follows the current one with no gap. */
  prepare?(sentence: Sentence): void
  /** Hold what is being said, to be resumed where it stopped. A voice that cannot pause leaves these out. */
  pause?(): void
  resume?(): void
}

/** What is being said right now. */
export interface Speaking {
  /** The sentence being heard, which is also the caption to show. Nothing when silent, or while its sound is made. */
  sentence: Sentence | undefined
  /** When its sound started, in milliseconds by `Date.now()` unless the player was given another clock, and how long it lasts in seconds, when the voice says. */
  since: number | undefined
  seconds: number | undefined
  /** Sentences announced and not yet heard, the one whose sound is being made included. */
  waiting: number
  /** The user paused: nothing is said until they resume. */
  paused: boolean
}

export interface SpeechPlayer extends Followed<Speaking> {
  /** Cut what is being said and forget what was waiting. */
  stop(): void
  /** Hold what is being said; `resume` carries on from there. */
  pause(): void
  resume(): void
  /** Use another voice from the next sentence on. */
  use(voice: DeviceVoice): void
  close(): void
}

/**
 * Says the sentences of the conversation one at a time, in the order announced, through the device's voice.
 * A turn that is stopped is cut at once, and so is everything said when the user starts a new turn.
 */
export function playSpeech(channel: ChannelState, initial: DeviceVoice, now: () => number = Date.now): SpeechPlayer {
  const state = cell<Speaking>({ sentence: undefined, since: undefined, seconds: undefined, waiting: 0, paused: false })
  let paused = false
  const queue: Sentence[] = []
  let voice = initial
  /** The sentence given to the voice: `since` is set once it is heard. */
  type Playing = { sentence: Sentence; cancel(): void; since: number | undefined; seconds: number | undefined }
  let playing: Playing | undefined

  const publish = () => {
    const heard = playing?.since !== undefined ? playing : undefined
    state.set({
      sentence: heard?.sentence,
      since: heard?.since,
      seconds: heard?.seconds,
      waiting: queue.length + (playing && !heard ? 1 : 0),
      paused
    })
  }

  const next = () => {
    if (playing || paused) return
    const sentence = queue.shift()
    if (!sentence) return publish()
    const saying = voice.say(sentence)
    const mine: Playing = { sentence, cancel: saying.cancel, since: undefined, seconds: undefined }
    playing = mine
    // The sound of the sentences after it is made while it plays, so each follows the one before with no gap.
    for (const ahead of queue) voice.prepare?.(ahead)
    const heard = (seconds: number | undefined) => {
      if (playing !== mine) return
      mine.since = now()
      mine.seconds = seconds
      publish()
    }
    if (saying.heard) void saying.heard.then(heard, () => heard(undefined))
    else heard(undefined)
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
    if (playing) voice.prepare?.(sentence)
    next()
    publish()
  })
  const stopStops = channel.onStopped((turn: TurnId) => drop((sentence) => sentence.turn !== turn))

  return {
    current: state.current,
    subscribe: state.subscribe,
    stop: () => {
      paused = false
      voice.resume?.()
      drop(() => false)
    },
    pause() {
      if (paused) return
      paused = true
      voice.pause?.()
      publish()
    },
    resume() {
      if (!paused) return
      paused = false
      voice.resume?.()
      next()
      publish()
    },
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
