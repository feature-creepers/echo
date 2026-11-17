import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { PersonaId, Settings } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SpeechEngine } from '../audio/engine.ts'
import { useTalk } from '../audio/use-talk.ts'
import { refusalCopy } from '../personas/copy.ts'
import { Orb } from '../presence/orb.tsx'
import type { Mood } from '../presence/painter.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { accentStyle } from '../styles/accent.ts'
import { ViewPanel } from '../view/view-panel.tsx'
import { InputLine } from './input-line.tsx'

export interface StageProps {
  client: Client
  personas: Settings['personas']
  /** Make another persona the one that answers. */
  onSwitch(persona: PersonaId): Promise<void>
  /** Open the settings, on the engine, when the assistant has nothing to think with. */
  onSetUpEngine(): void
  /** The device's speech engines. Left out, the user types and the assistant's sentences are only shown. */
  speech?: SpeechEngine | undefined
  /** How loud the assistant's voice is right now, when the device speaks it. */
  voiceLevel?: (() => number) | undefined
  /** Open the voice settings, when the device could talk once its models are downloaded. */
  onSetUpVoice?: (() => void) | undefined
}

const MOODS: Record<Mood, string> = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', asleep: 'Asleep' }

/**
 * A voice's loudness when there is no sound to measure: the rise and fall of syllables, made from a few
 * waves that never line up the same way twice. It keeps the core alive while sentences are shown, not played.
 */
function syllables(): number {
  const time = performance.now() / 1000
  const beat = Math.abs(Math.sin(time * 7.3)) * Math.abs(Math.sin(time * 2.1 + 0.6))
  return 0.25 + 0.6 * beat + 0.15 * Math.abs(Math.sin(time * 13.7))
}

/**
 * The main screen: the assistant, present. The core in the middle, what it is saying under it as it says
 * it, and the line to talk to it at the bottom.
 */
export function Stage({ client, personas, onSwitch, onSetUpEngine, speech, voiceLevel, onSetUpVoice }: StageProps) {
  const channel = useFollowed(client.channel)
  const speaking = useFollowed(client.speech)
  const engines = useFollowed(client.engines)
  const view = useFollowed(client.view)
  const [problem, setProblem] = useState<string>()

  const active = personas.available.find((persona) => persona.id === personas.active) ?? personas.available[0]
  const last = channel.exchanges.at(-1)
  const running = channel.running !== undefined
  const noEngine = engines !== undefined && engines.active === undefined

  const say = useCallback(
    (text: string) => {
      setProblem(undefined)
      client.speech.stop()
      client.channel.say(text).catch(() => setProblem(refusalCopy('failed')))
    },
    [client]
  )
  const stop = useCallback(() => {
    client.speech.stop()
    client.channel.stop().catch(() => undefined)
  }, [client])

  const {
    talk,
    start,
    finish,
    cancel,
    level: heardLevel,
    available: canTalk
  } = useTalk(speech, (text, language) => {
    setProblem(undefined)
    client.speech.stop()
    client.channel.say(text, language).catch(() => setProblem(refusalCopy('failed')))
  })
  const listening = talk.is === 'listening'
  const mood: Mood = listening ? 'listening' : talk.is === 'transcribing' ? 'thinking' : speaking.sentence ? 'speaking' : running ? 'thinking' : 'idle'
  const failed =
    talk.is === 'failed' ? talk.reason : !running && !speaking.sentence && last?.outcome === 'failed' ? (last.problem ?? 'It could not answer.') : undefined

  // The core moves with the voice it hears, or the voice it speaks; with no sound, with the rhythm of syllables.
  const moods = useRef({ listening, voiceLevel })
  moods.current = { listening, voiceLevel }
  const level = useRef(() => (moods.current.listening ? heardLevel() : (moods.current.voiceLevel?.() ?? syllables())))

  // Starting to talk stops the assistant. Ctrl+Space (or Cmd+Space on a Mac) starts listening, and again sends.
  const toggle = useCallback(() => {
    if (listening) return void finish()
    stop()
    void start()
  }, [listening, finish, start, stop])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        toggle()
      } else if (event.key === 'Escape' && listening) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, listening, cancel])

  if (!active) return null

  const caption = (
    <AnimatePresence mode="wait">
      {speaking.sentence ? (
        <motion.p
          key={`${speaking.sentence.turn}:${speaking.sentence.text}`}
          initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className={cn('text-balance leading-snug', view ? 'text-lg' : 'text-2xl')}
        >
          {speaking.sentence.text}
        </motion.p>
      ) : running && last ? (
        <motion.p
          key={`said:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-balance text-lg text-text-faint leading-snug"
        >
          “{last.said}”
        </motion.p>
      ) : failed || problem ? (
        <motion.div
          key="problem"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn('grid gap-3', !view && 'justify-items-center')}
        >
          <p className="text-balance text-danger leading-relaxed">{failed ?? problem}</p>
          {noEngine && (
            <button
              type="button"
              onClick={onSetUpEngine}
              className="w-fit font-mono text-text-soft text-xs underline decoration-line-strong underline-offset-4 hover:text-text"
            >
              Set up an AI program
            </button>
          )}
        </motion.div>
      ) : last?.replied ? (
        <motion.p
          key={`last:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="line-clamp-3 text-balance text-lg text-text-faint leading-snug"
        >
          {last.replied}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {view ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <motion.div layout className="mx-auto flex w-full max-w-5xl items-center gap-5 px-8 pt-5 pb-3">
            <Orb size={84} mood={mood} level={level.current} className="-m-3 shrink-0" />
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex items-baseline gap-3">
                <span className="font-medium text-lg">{active.name}</span>
                <Eyebrow accent={mood !== 'idle'}>{MOODS[mood]}</Eyebrow>
              </div>
              <div className="min-h-7" aria-live="polite">
                {caption}
              </div>
            </div>
          </motion.div>
          <ViewPanel view={view} onSay={say} onClose={() => void client.view.clear().catch(() => undefined)} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
          <Orb size={300} mood={mood} level={level.current} className="-my-6" />
          <div className="grid justify-items-center gap-1.5">
            <h1 className="font-medium text-4xl tracking-tight">{active.name}</h1>
            <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-300">
              {MOODS[mood]}
            </Eyebrow>
          </div>
          <div className="mt-8 flex h-28 w-full max-w-2xl items-start justify-center text-center" aria-live="polite">
            {caption}
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-3xl gap-3 px-8 pb-7">
        <InputLine
          name={active.name}
          busy={running || speaking.sentence !== undefined}
          onSay={say}
          onStop={stop}
          talk={canTalk ? { listening, onPress: toggle } : onSetUpVoice ? { listening: false, onPress: onSetUpVoice } : undefined}
        />
        <div className="flex items-center justify-between gap-4 px-1">
          <div role="radiogroup" aria-label="Who answers" className="flex items-center gap-1">
            {personas.available.map((persona) => {
              const answers = persona.id === personas.active
              return (
                // biome-ignore lint/a11y/useSemanticElements: a row of names that reads as buttons, with the behaviour of a radio group
                <button
                  key={persona.id}
                  type="button"
                  role="radio"
                  aria-checked={answers}
                  style={accentStyle(persona.accent)}
                  onClick={() => {
                    if (!answers) onSwitch(persona.id).catch(() => setProblem(refusalCopy('failed')))
                  }}
                  className={cn(
                    'flex h-7 items-center gap-2 rounded-sm px-2.5 text-xs transition duration-150 ease-soft',
                    answers ? 'bg-accent/12 text-text' : 'text-text-faint hover:bg-raised hover:text-text-soft'
                  )}
                >
                  <span className={cn('size-1.5 rounded-full bg-accent transition', answers ? 'shadow-[0_0_8px_var(--accent)]' : 'opacity-40')} />
                  {persona.name}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onSetUpEngine}
            className="flex items-center gap-2 rounded-sm px-2 py-1 font-mono text-label text-text-faint uppercase transition hover:text-text-soft"
          >
            <span className={cn('size-1.5 rounded-full', engines === undefined ? 'bg-text-faint/50' : noEngine ? 'bg-warn' : 'bg-ok')} />
            {engines === undefined
              ? 'Looking'
              : noEngine
                ? 'No AI program ready'
                : (engines.harnesses.find((harness) => harness.id === engines.active)?.name ?? 'Ready')}
          </button>
        </div>
      </div>
    </div>
  )
}
