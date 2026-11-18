import { pauseMs } from '@repo/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { playCue } from './cues.ts'
import { findDevice } from './devices.ts'
import type { SpeechEngine } from './engine.ts'
import { record, type Take } from './recorder.ts'

/** Where talking stands. */
export type Talk =
  | { is: 'idle' }
  | { is: 'listening' }
  /** The recording is being turned into text. */
  | { is: 'transcribing' }
  /** Something went wrong, in words for the user. */
  | { is: 'failed'; reason: string }

/** How quiet counts as silence. How long a silence ends a take once the user has spoken is a setting of the device. */
const SILENCE_LEVEL = 0.06
/** A take shorter than this is a slip of the key, not something said. */
const SHORTEST_MS = 350
/** Nothing heard for this long after starting: the take ends empty. */
const NOTHING_MS = 8000
/** What is heard this soon after starting is the cue that marks it, not the user. */
const CUE_MS = 260

/**
 * Push to talk: `start` opens the microphone chosen for this device, `finish` turns what was said into text
 * and hands it to `onHeard`. A take also finishes by itself after a silence that follows speech, unless the
 * user set it to wait for the key.
 */
export function useTalk(engine: SpeechEngine | undefined, onHeard: (text: string, language: string | undefined) => void) {
  const [talk, setTalk] = useState<Talk>({ is: 'idle' })
  const take = useRef<{ take: Take; started: number; spoke: boolean; quietSince: number } | undefined>(undefined)
  const heard = useRef(onHeard)
  heard.current = onHeard
  // Read when used, so that a change in settings applies to the next take without starting anything again.
  const { settings } = useDevice()
  const device = useRef(settings)
  device.current = settings
  const cue = useCallback((which: 'open' | 'close') => {
    if (!device.current.listening.sounds) return
    void findDevice(device.current.speaker, 'audiooutput').then((sink) => playCue(which, sink))
  }, [])

  const finish = useCallback(async () => {
    const current = take.current
    if (!current || !engine) return
    take.current = undefined
    cue('close')
    const sound = await current.take.finish()
    if (Date.now() - current.started < SHORTEST_MS || !current.spoke) return setTalk({ is: 'idle' })
    setTalk({ is: 'transcribing' })
    try {
      const { text, language } = await engine.transcribe(sound)
      setTalk({ is: 'idle' })
      if (text.trim() !== '') heard.current(text.trim(), language)
    } catch (error) {
      setTalk({ is: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  }, [engine, cue])

  /** The microphone is being opened: a second press meanwhile must not open another one. */
  const opening = useRef(false)

  const start = useCallback(async () => {
    if (!engine || take.current || opening.current) return
    opening.current = true
    try {
      cue('open')
      const opened = await record(device.current.microphone)
      take.current = { take: opened, started: Date.now(), spoke: false, quietSince: Date.now() }
      setTalk({ is: 'listening' })
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      setTalk({ is: 'failed', reason: denied ? 'The microphone is not allowed. Allow it in the system settings.' : 'No microphone could be opened.' })
    } finally {
      opening.current = false
    }
  }, [engine, cue])

  const cancel = useCallback(() => {
    take.current?.take.cancel()
    take.current = undefined
    setTalk({ is: 'idle' })
  }, [])

  // Watch the level: speech followed by silence ends the take, and so does a long wait with nothing said.
  useEffect(() => {
    if (talk.is !== 'listening') return
    const timer = window.setInterval(() => {
      const current = take.current
      if (!current) return
      const now = Date.now()
      const pause = pauseMs(device.current.listening.pause)
      if (current.take.level() > SILENCE_LEVEL && now - current.started > CUE_MS) {
        current.spoke = true
        current.quietSince = now
      } else if (current.spoke && pause !== undefined && now - current.quietSince > pause) {
        void finish()
      } else if (!current.spoke && now - current.started > NOTHING_MS) {
        if (pause !== undefined) cancel()
      }
    }, 60)
    return () => window.clearInterval(timer)
  }, [talk.is, finish, cancel])

  useEffect(() => cancel, [cancel])

  return { talk, start, finish, cancel, level: () => take.current?.take.level() ?? 0, available: engine !== undefined }
}
