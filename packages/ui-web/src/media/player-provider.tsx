import { useFollowed } from '@repo/client/react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { createMediaPlayer, type MediaPlayer, type MediaSource, type PlayerState } from './player.ts'

/** Where the level the user set is kept: on this device, like the voices. */
const VOLUME = 'echo.media-volume'

function readVolume(): number {
  try {
    const kept = Number(localStorage.getItem(VOLUME))
    return localStorage.getItem(VOLUME) !== null && Number.isFinite(kept) ? Math.max(0, Math.min(1, kept)) : 0.8
  } catch {
    return 0.8
  }
}

interface Playback {
  player: MediaPlayer
  /** Lend the element to a block that draws the video. Gives a function that takes it back. */
  lend(container: HTMLElement): () => void
}

const PlaybackContext = createContext<Playback | undefined>(undefined)

/**
 * The app's one player, for everything inside. Its element lives in a holder outside every view, so what
 * plays goes on when a view is replaced; a block showing a video borrows the element while it is drawn.
 * Moving a playing element from one parent to another does not interrupt it.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const [playback] = useState<Playback>(() => {
    const holder = document.createElement('div')
    holder.setAttribute('aria-hidden', 'true')
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none'
    const element = document.createElement('video')
    element.playsInline = true
    element.preload = 'none'
    element.className = 'size-full object-contain'
    holder.append(element)
    document.body.append(holder)
    const player = createMediaPlayer({ element, volume: readVolume() })
    /** The containers that borrowed the element, the latest last: it goes back to the one before when one lets go. */
    const borrowers: HTMLElement[] = []
    return {
      player,
      lend(container) {
        borrowers.push(container)
        container.append(element)
        return () => {
          const at = borrowers.lastIndexOf(container)
          if (at >= 0) borrowers.splice(at, 1)
          if (element.parentElement === container) (borrowers.at(-1) ?? holder).append(element)
        }
      }
    }
  })

  // The level the user set is kept for the next launch.
  useEffect(
    () =>
      playback.player.subscribe(() => {
        try {
          localStorage.setItem(VOLUME, String(playback.player.current().volume))
        } catch {
          // Not kept: the level lasts until the app closes.
        }
      }),
    [playback]
  )

  // The system's media keys and its "now playing" panel control the player too.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => playback.player.current().source && playback.player.play(playback.player.current().source as MediaSource)],
      ['pause', () => playback.player.pause()],
      ['stop', () => playback.player.stop()]
    ]
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // An action this system does not know.
      }
    }
    let shown: string | undefined
    const stop = playback.player.subscribe(() => {
      const { source, status } = playback.player.current()
      session.playbackState = status === 'playing' || status === 'loading' ? 'playing' : source ? 'paused' : 'none'
      if (source?.url === shown) return
      shown = source?.url
      session.metadata = source
        ? new MediaMetadata({ title: source.title, artist: source.subtitle ?? '', artwork: source.artwork ? [{ src: source.artwork }] : [] })
        : null
    })
    return () => {
      stop()
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null)
        } catch {
          // As above.
        }
      }
    }
  }, [playback])

  return <PlaybackContext.Provider value={playback}>{children}</PlaybackContext.Provider>
}

function usePlayback(): Playback {
  const playback = useContext(PlaybackContext)
  if (!playback) throw new Error('A media block is drawn outside the player.')
  return playback
}

/** The app's player. */
export const usePlayer = (): MediaPlayer => usePlayback().player

/** What the player is doing, kept current. */
export function usePlayerState(): PlayerState {
  return useFollowed(usePlayback().player)
}

/** A ref for the box a video is drawn in: it borrows the player's element while this source is the one loaded. */
export function useVideoSurface(source: MediaSource, held: boolean): (container: HTMLDivElement | null) => (() => void) | undefined {
  const { lend } = usePlayback()
  const video = source.kind === 'video' && held
  return useCallback((container: HTMLDivElement | null) => (container && video ? lend(container) : undefined), [lend, video])
}
