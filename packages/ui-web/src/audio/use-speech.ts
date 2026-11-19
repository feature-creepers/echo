import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Persona } from '@repo/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { silentVoice } from '../conversation/silent-voice.ts'
import { useDevice } from '../device/device.tsx'
import { findDevice } from './devices.ts'
import { favouring, type InstallProgress, type SpeechEngine, type SpeechReadiness } from './engine.ts'
import { namesAsWords } from './names.ts'
import { engineVoice, type SpeakingVoice } from './voice.ts'
import { paceOf, styleOf, withPick } from './voice-styles.ts'

/** Where earlier versions kept the voices picked, one for every language: let go, since a style is now picked by language. */
const EARLIER_PICKS = 'echo.voices'

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
  /** Its spectrum right now, read into the bands given; nothing while it has not spoken. */
  bands: (into: Float32Array) => Float32Array | undefined
  /** The voice styles there are, once the engines have said. */
  styles: { id: string; name: string }[]
  /** The style a persona speaks a language in, picked or by default. */
  styleOf(persona: Persona, language: string): string
  /** Pick a persona's voice in a language. */
  pick(persona: Persona, language: string, style: string): void
  /**
   * Say a sentence as a persona speaks, in its voice and at its pace: in the language given, English otherwise,
   * at the pace set or the one given.
   */
  preview(persona: Persona, text: string, how?: { language?: string; speed?: number }): void
}

/**
 * The device's speech, for the whole interface: whether its models are installed, their download, and the
 * assistant's voice, which speaks in the style of the persona in use once the models are there.
 */
export function useDeviceSpeech(engine: SpeechEngine | undefined, client: Client, persona: Persona | undefined): DeviceSpeech {
  const [readiness, setReadiness] = useState<SpeechReadiness>()
  const [install, setInstall] = useState<Install>({ is: 'idle' })
  const voice = useRef<SpeakingVoice | undefined>(undefined)
  const [styles, setStyles] = useState<{ id: string; name: string }[]>([])
  // Every persona's name, which the voice says as a word although it is written in capitals.
  const snapshot = useFollowed(client.settings)
  const names = useRef<readonly string[]>([])
  names.current = snapshot.state === 'ready' ? snapshot.settings.personas.available.map((one) => one.name) : []
  const spoken = useCallback((text: string) => namesAsWords(text, names.current), [])
  // The person's own words, read for each utterance: the recogniser favours them.
  const words = useRef<readonly string[]>([])
  words.current = snapshot.state === 'ready' ? snapshot.settings.vocabulary : []
  // How the voice speaks and where it plays are settings of this device, read for each sentence.
  const { settings, change } = useDevice()
  const manner = useRef({ speed: settings.voice.speed, sink: undefined as string | undefined })
  manner.current.speed = settings.voice.speed
  // The persona speaking and the styles picked, read for each sentence so that a change applies to the next one.
  const picked = settings.voice.styles
  const speaking = useRef({ persona, picked })
  speaking.current = { persona, picked }
  const { aloud } = settings.voice
  const speaker = settings.speaker

  // The speakers chosen, found again among those there now, and again when one is plugged in or out.
  useEffect(() => {
    let live = true
    const find = () => {
      findDevice(speaker, 'audiooutput')
        .then((sink) => {
          if (live) manner.current.sink = sink
        })
        .catch(() => undefined)
    }
    find()
    navigator.mediaDevices?.addEventListener('devicechange', find)
    return () => {
      live = false
      navigator.mediaDevices?.removeEventListener('devicechange', find)
    }
  }, [speaker])

  useEffect(() => {
    engine
      ?.status()
      .then(setReadiness)
      .catch(() => undefined)
  }, [engine])

  const installed = engine && readiness?.ready ? engine : undefined
  const ready = useMemo(() => installed && favouring(installed, () => words.current), [installed])

  useEffect(() => {
    ready
      ?.styles()
      .then(setStyles)
      .catch(() => undefined)
  }, [ready])

  useEffect(() => {
    try {
      localStorage.removeItem(EARLIER_PICKS)
    } catch {
      // Nothing kept there to let go of.
    }
  }, [])

  const pick = useCallback(
    (persona: Persona, language: string, style: string) => {
      change({ voice: { styles: withPick(speaking.current.picked, persona, language, style) } })
    },
    [change]
  )

  const preview = useCallback(
    (persona: Persona, text: string, how: { language?: string; speed?: number } = {}) => {
      if (!ready) return
      const sample = engineVoice(ready, {
        style: (language) => styleOf(persona, language, speaking.current.picked),
        speed: () => paceOf(persona, how.speed ?? manner.current.speed),
        sink: () => manner.current.sink,
        spoken
      })
      sample.say({ turn: 'preview', text, language: how.language })
    },
    [ready, spoken]
  )

  // Answers are spoken once the voice is installed, unless the user wants them only shown.
  useEffect(() => {
    if (!ready || !aloud) return
    const made = engineVoice(ready, {
      style: (language) => styleOf(speaking.current.persona, language, speaking.current.picked),
      speed: () => paceOf(speaking.current.persona, manner.current.speed),
      sink: () => manner.current.sink,
      spoken
    })
    voice.current = made
    client.speech.use(made)
    return () => {
      voice.current = undefined
      client.speech.use(silentVoice())
    }
  }, [ready, aloud, client, spoken])

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

  return {
    readiness,
    install,
    startInstall,
    ready,
    level: () => voice.current?.level() ?? 0,
    bands: (into) => voice.current?.bands(into),
    styles,
    styleOf: (one, language) => styleOf(one, language, picked),
    pick,
    preview
  }
}
