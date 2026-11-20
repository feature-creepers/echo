import { cell, type Followed } from '@repo/client'

/** What a Media block asks to play: the stream or file, and how to present it. */
export interface MediaSource {
  url: string
  kind: 'audio' | 'video'
  title: string
  subtitle?: string | undefined
  artwork?: string | undefined
  /** A stream with no end: no seeking, and resuming goes back to what is on now. */
  live: boolean
}

type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'failed'

export interface PlayerState {
  /** What is loaded. Nothing once stopped. */
  source: MediaSource | undefined
  status: PlayerStatus
  /** Waiting for data while it should be playing. */
  buffering: boolean
  /** Why it failed, in words for the user. */
  problem: string | undefined
  /** The level the user set, from 0 to 1. What is heard is lower while the assistant speaks. */
  volume: number
  muted: boolean
  /** Lowered under the assistant's voice. */
  ducked: boolean
  /** For a file: where it is, and how long it lasts, in seconds. */
  position: number
  duration: number | undefined
  /** What plays after the current source ends, in order. */
  queue: MediaSource[]
}

/** The part of an HTMLMediaElement the player uses: small enough for a test to stand in for it. */
export interface MediaElement {
  src: string
  volume: number
  muted: boolean
  readonly paused: boolean
  currentTime: number
  readonly duration: number
  readonly error: { code: number } | null
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
  addEventListener(type: string, listener: () => void): void
}

export interface MediaPlayer extends Followed<PlayerState> {
  /** Play a source: what played before stops. The same source, paused, resumes. */
  play(source: MediaSource): void
  pause(): void
  /** Play or pause this source. */
  toggle(source: MediaSource): void
  /** Stop and let go of the source. */
  stop(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  /** Add a source to the queue: it plays once what plays now ends, or at once when nothing plays. */
  enqueue(source: MediaSource): void
  /** Play what the queue has next; nothing playing is left when it is empty. */
  next(): void
  clearQueue(): void
  setMuted(muted: boolean): void
  /** Lower the sound for a reason (the assistant speaking, the user talking), until every reason is gone. */
  duck(reason: string, on: boolean): void
  /**
   * Play a source by itself, once: a view shown in answer to "play…" starts as it appears, but drawing it
   * again (another screen, the side sheet) does not start it a second time.
   */
  autoplay(key: string, source: MediaSource): void
}

/** How much of the user's level is heard under the assistant's voice. */
export const DUCKED = 0.18
/** How long the level takes to go down or back up, in milliseconds. */
const FADE_MS = 280
const FADE_STEPS = 10

/** A media error in words for the user, by the code the element gives. */
const PROBLEMS: Record<number, string> = {
  1: 'Playback was stopped.',
  2: 'The stream could not be reached.',
  3: 'The stream could not be decoded.',
  4: 'This address is not a stream this app can play.'
}

interface PlayerOptions {
  /** The one element everything plays through. A video element plays sound too, so one is enough. */
  element: MediaElement
  /** The level to start at. */
  volume?: number
  /** Runs a step of a fade later. Left out, `setTimeout`. */
  later?: (step: () => void, ms: number) => void
}

/**
 * One player for the whole app. One sound plays at a time, whichever view asked for it, and it goes on when
 * that view is replaced or closed: the element lives outside every view, which only show its state and
 * borrow it to draw a video.
 */
export function createMediaPlayer({ element, volume = 0.8, later = (step, ms) => void setTimeout(step, ms) }: PlayerOptions): MediaPlayer {
  const state = cell<PlayerState>({
    source: undefined,
    status: 'idle',
    buffering: false,
    problem: undefined,
    volume,
    muted: false,
    ducked: false,
    position: 0,
    duration: undefined,
    queue: []
  })
  const set = (change: Partial<PlayerState>) => state.set({ ...state.current(), ...change })
  const ducking = new Set<string>()
  const autoplayed = new Set<string>()
  let fade = 0

  /** Bring what is heard to the level wanted, smoothly. */
  const level = (immediate = false) => {
    const { volume: wanted, ducked } = state.current()
    const target = Math.max(0, Math.min(1, wanted * (ducked ? DUCKED : 1)))
    const run = ++fade
    const from = element.volume
    if (immediate || Math.abs(target - from) < 0.01) {
      element.volume = target
      return
    }
    for (let step = 1; step <= FADE_STEPS; step++) {
      later(
        () => {
          if (run === fade) element.volume = from + ((target - from) * step) / FADE_STEPS
        },
        (FADE_MS * step) / FADE_STEPS
      )
    }
  }

  const same = (one: MediaSource | undefined, other: MediaSource) => one?.url === other.url

  const start = (source: MediaSource, reload: boolean) => {
    if (reload) {
      element.src = source.url
      element.load()
    }
    set({ source, status: 'loading', problem: undefined, buffering: false, ...(reload ? { position: 0, duration: undefined } : {}) })
    level(true)
    element.play().then(
      () => undefined,
      (error: unknown) => {
        // Interrupted by a newer source or by a load, or failed with an error the element reports itself.
        if (!same(state.current().source, source)) return
        if (error instanceof Error && error.name === 'AbortError') return
        if (element.error) return
        // Refused before any sound, most often because nothing was pressed yet: it waits for the user.
        set({ status: 'paused' })
      }
    )
  }

  element.addEventListener('playing', () => set({ status: 'playing', buffering: false, problem: undefined }))
  element.addEventListener('pause', () => {
    if (state.current().status !== 'idle' && state.current().status !== 'failed') set({ status: 'paused', buffering: false })
  })
  element.addEventListener('waiting', () => {
    if (state.current().status === 'playing' || state.current().status === 'loading') set({ buffering: true })
  })
  // At the end of a file, the queue goes on by itself.
  element.addEventListener('ended', () => {
    if (state.current().queue.length > 0) player.next()
    else set({ status: 'paused', buffering: false })
  })
  element.addEventListener('timeupdate', () => {
    const { source, position } = state.current()
    if (source && !source.live && Math.abs(element.currentTime - position) >= 0.5) set({ position: element.currentTime })
  })
  element.addEventListener('durationchange', () => {
    const duration = Number.isFinite(element.duration) ? element.duration : undefined
    set({ duration })
  })
  element.addEventListener('error', () => {
    if (!state.current().source) return
    set({ status: 'failed', buffering: false, problem: PROBLEMS[element.error?.code ?? 2] ?? PROBLEMS[2] })
  })

  const player: MediaPlayer = {
    current: state.current,
    subscribe: state.subscribe,

    play(source) {
      const now = state.current()
      if (same(now.source, source) && now.status !== 'failed') {
        if (now.status === 'playing' || now.status === 'loading') return
        // A live stream that was paused is behind what is on now: it starts again from now.
        return start(source, source.live)
      }
      start(source, true)
    },

    pause() {
      if (!state.current().source) return
      element.pause()
      set({ status: 'paused', buffering: false })
    },

    toggle(source) {
      const now = state.current()
      if (same(now.source, source) && (now.status === 'playing' || now.status === 'loading')) player.pause()
      else player.play(source)
    },

    stop() {
      if (!state.current().source) return
      set({ source: undefined, status: 'idle', buffering: false, problem: undefined, position: 0, duration: undefined, queue: [] })
      element.pause()
      element.removeAttribute('src')
      element.load()
    },

    enqueue(source) {
      const now = state.current()
      if (!now.source || now.status === 'idle') return player.play(source)
      set({ queue: [...now.queue, source] })
    },

    next() {
      const [first, ...rest] = state.current().queue
      if (!first) return player.stop()
      set({ queue: rest })
      start(first, true)
    },

    clearQueue() {
      set({ queue: [] })
    },

    seek(seconds) {
      const { source, duration } = state.current()
      if (!source || source.live) return
      element.currentTime = Math.max(0, Math.min(duration ?? seconds, seconds))
      set({ position: element.currentTime })
    },

    setVolume(next) {
      set({ volume: Math.max(0, Math.min(1, next)), muted: next > 0 ? false : state.current().muted })
      element.muted = state.current().muted
      level(true)
    },

    setMuted(muted) {
      element.muted = muted
      set({ muted })
    },

    duck(reason, on) {
      if (on) ducking.add(reason)
      else ducking.delete(reason)
      const ducked = ducking.size > 0
      if (ducked === state.current().ducked) return
      set({ ducked })
      level()
    },

    autoplay(key, source) {
      if (autoplayed.has(key)) return
      autoplayed.add(key)
      player.play(source)
    }
  }
  return player
}
