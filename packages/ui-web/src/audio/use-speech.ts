import type { Client } from '@repo/client'
import type { Persona } from '@repo/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { silentVoice } from '../conversation/silent-voice.ts'
import type { InstallProgress, SpeechEngine, SpeechReadiness } from './engine.ts'
import { engineVoice, type SpeakingVoice } from './voice.ts'

/** The voice style of each stance, until the user picks their own: a calm voice that goes along, a deeper one that questions. */
const STYLE_OF_STANCE: Record<Persona['stance'], string> = { accommodating: 'f1', critical: 'm2' }

export type Install = { is: 'idle' } | { is: 'running'; progress: InstallProgress | undefined } | { is: 'failed'; reason: string }

export interface DeviceSpeech {
  /** Where the device's speech stands. Nothing until it has been asked, or when the device has no engines. */
  readiness: SpeechReadiness | undefined
  install: Install
  startInstall(): void
  /** The engines, once every model is installed. */
  ready: SpeechEngine | undefined
  /** How loud the assistant's voice is right now. */
  level: () => number
}

/**
 * The device's speech, for the whole interface: whether its models are installed, their download, and the
 * assistant's voice, which speaks in the style of the persona in use once the models are there.
 */
export function useDeviceSpeech(engine: SpeechEngine | undefined, client: Client, persona: Persona | undefined): DeviceSpeech {
  const [readiness, setReadiness] = useState<SpeechReadiness>()
  const [install, setInstall] = useState<Install>({ is: 'idle' })
  const voice = useRef<SpeakingVoice | undefined>(undefined)
  const stance = useRef(persona?.stance)
  stance.current = persona?.stance

  useEffect(() => {
    engine
      ?.status()
      .then(setReadiness)
      .catch(() => undefined)
  }, [engine])

  const ready = engine && readiness?.ready ? engine : undefined

  useEffect(() => {
    if (!ready) return
    const made = engineVoice(ready, () => STYLE_OF_STANCE[stance.current ?? 'accommodating'])
    voice.current = made
    client.speech.use(made)
    return () => {
      voice.current = undefined
      client.speech.use(silentVoice())
    }
  }, [ready, client])

  const startInstall = useCallback(() => {
    if (!engine) return
    setInstall({ is: 'running', progress: undefined })
    engine
      .install((progress) => setInstall({ is: 'running', progress }))
      .then(() => engine.status())
      .then((status) => {
        setReadiness(status)
        setInstall({ is: 'idle' })
      })
      .catch((error: unknown) => setInstall({ is: 'failed', reason: error instanceof Error ? error.message : String(error) }))
  }, [engine])

  return { readiness, install, startInstall, ready, level: () => voice.current?.level() ?? 0 }
}
