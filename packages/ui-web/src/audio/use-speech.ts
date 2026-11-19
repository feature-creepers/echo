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

/**
 * The voice style of each stance, until the user picks their own, chosen by ear and by measuring the styles'
 * pitch and pace. The stance that goes along speaks as a polished, assured aide: crisp, quick, the most even
 * of the lighter voices. The one that questions speaks in the deep, composed voice whose pitch moves least:
 * calm, level, never raised. The voice speaks every language in the same style, so each persona sounds like
 * itself in French as in English.
 */
const STYLE_OF_STANCE: Record<Persona['stance'], string> = { accommodating: 'm3', critical: 'm2' }

/** How each stance's pace compares with the pace set: the one that questions takes its time. */
const PACE_OF_STANCE: Record<Persona['stance'], number> = { accommodating: 1, critical: 0.95 }

/** The pace a persona speaks at, from the pace set. */
export function paceOf(persona: Persona | undefined, speed: number): number {
  return speed * PACE_OF_STANCE[persona?.stance ?? 'accommodating']
}

/** Where the voices the user picked are kept: on this device, since speakers and taste belong to it. */
const PICKED = 'echo.voices'

function readPicked(): Record<string, string> {
  try {
    const kept = JSON.parse(localStorage.getItem(PICKED) ?? '{}') as unknown
    return typeof kept === 'object' && kept !== null ? (kept as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** The voice style a persona speaks in: the one the user picked for it, or its stance's. */
export function styleOf(persona: Persona | undefined, picked: Record<string, string>): string {
  if (!persona) return STYLE_OF_STANCE.accommodating
  return picked[persona.id] ?? STYLE_OF_STANCE[persona.stance]
}

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
  /** The style each persona speaks in, picked or by default. */
  styleOf(persona: Persona): string
  /** Pick a persona's voice. */
  pick(persona: string, style: string): void
  /** Say a sentence as a persona speaks, in its voice and at its pace, from the pace set or the one given. */
  preview(persona: Persona, text: string, speed?: number): void
}

/**
 * The device's speech, for the whole interface: whether its models are installed, their download, and the
 * assistant's voice, which speaks in the style of the persona in use once the models are there.
 */
export function useDeviceSpeech(engine: SpeechEngine | undefined, client: Client, persona: Persona | undefined): DeviceSpeech {
  const [readiness, setReadiness] = useState<SpeechReadiness>()
  const [install, setInstall] = useState<Install>({ is: 'idle' })
  const voice = useRef<SpeakingVoice | undefined>(undefined)
  const [picked, setPicked] = useState(readPicked)
  const [styles, setStyles] = useState<{ id: string; name: string }[]>([])
  const speaking = useRef({ persona, picked })
  speaking.current = { persona, picked }
  // Every persona's name, which the voice says as a word although it is written in capitals.
  const snapshot = useFollowed(client.settings)
  const names = useRef<readonly string[]>([])
  names.current = snapshot.state === 'ready' ? snapshot.settings.personas.available.map((one) => one.name) : []
  const spoken = useCallback((text: string) => namesAsWords(text, names.current), [])
  // The person's own words, read for each utterance: the recogniser favours them.
  const words = useRef<readonly string[]>([])
  words.current = snapshot.state === 'ready' ? snapshot.settings.vocabulary : []
  // How the voice speaks and where it plays are settings of this device, read for each sentence.
  const { settings } = useDevice()
  const manner = useRef({ speed: settings.voice.speed, sink: undefined as string | undefined })
  manner.current.speed = settings.voice.speed
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

  const pick = useCallback((id: string, style: string) => {
    setPicked((before) => {
      const next = { ...before, [id]: style }
      try {
        localStorage.setItem(PICKED, JSON.stringify(next))
      } catch {
        // Not kept: the choice lasts until the app closes.
      }
      return next
    })
  }, [])

  const preview = useCallback(
    (persona: Persona, text: string, speed?: number) => {
      if (!ready) return
      const sample = engineVoice(ready, {
        style: () => styleOf(persona, speaking.current.picked),
        speed: () => paceOf(persona, speed ?? manner.current.speed),
        sink: () => manner.current.sink,
        spoken
      })
      sample.say({ turn: 'preview', text, language: undefined })
    },
    [ready, spoken]
  )

  // Answers are spoken once the voice is installed, unless the user wants them only shown.
  useEffect(() => {
    if (!ready || !aloud) return
    const made = engineVoice(ready, {
      style: () => styleOf(speaking.current.persona, speaking.current.picked),
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
    styleOf: (one) => styleOf(one, picked),
    pick,
    preview
  }
}
