import type { Client } from '@repo/client'
import { matchesShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { PersonaId, Settings, ShownView } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessIndicator } from '../access/access-indicator.tsx'
import type { SpeechEngine } from '../audio/engine.ts'
import { useTalk } from '../audio/use-talk.ts'
import { keyPress, useDevice } from '../device/device.tsx'
import { usePlayer } from '../media/player-provider.tsx'
import { refusalCopy } from '../personas/copy.ts'
import { Orb } from '../presence/orb.tsx'
import type { Mood } from '../presence/painter.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Asides } from '../view/asides.tsx'
import type { ViewActions } from '../view/context.ts'
import { ViewPanel } from '../view/view-panel.tsx'
import { InputLine } from './input-line.tsx'
import { Suggestions } from './suggestions.tsx'

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

/** The event an app dispatches on the window to start talking, or to send what was said: its global shortcut. */
export const TALK_EVENT = 'echo:talk'

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
  const shown = useFollowed(client.view)
  const view = shown.stage
  const threads = useFollowed(client.threads)
  const asleep = useFollowed(client.memory.asleep)
  const ready = threads.threads.filter((thread) => thread.state === 'ready')
  const [problem, setProblem] = useState<string>()

  const active = personas.available.find((persona) => persona.id === personas.active) ?? personas.available[0]
  /** The persona the toggle hands over to: the next one in the list. */
  const other = personas.available[(personas.available.findIndex((persona) => persona.id === active?.id) + 1) % personas.available.length]
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
  const actions = useMemo(
    () => ({
      say,
      readFile: (file: string) => client.session.run('file.read', { file }),
      readShapes: (url: string) => client.session.run('shapes.read', { url }).then((read) => read.shapes)
    }),
    [say, client]
  )
  /**
   * Only a view shown in answer to what the person just asked may start what it plays. One read on opening,
   * or an earlier topic's view brought back on screen, never does: the person may have stopped it.
   */
  const answering = channel.running ?? channel.exchanges.at(-1)?.turn
  const actionsFor = useCallback(
    (shownView: ShownView): ViewActions =>
      shownView.turn !== undefined && shownView.turn === answering && shown.arrived.includes(shownView.id) ? { ...actions, autoplay: shownView.id } : actions,
    [actions, shown.arrived, answering]
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

  // What plays goes quiet while the person talks, so the music does not drown what they say.
  const player = usePlayer()
  useEffect(() => {
    player.duck('listening', listening)
    return () => player.duck('listening', false)
  }, [player, listening])
  const mood: Mood =
    asleep && !listening && !running && !speaking.sentence
      ? 'asleep'
      : listening
        ? 'listening'
        : talk.is === 'transcribing'
          ? 'thinking'
          : speaking.sentence
            ? 'speaking'
            : running
              ? 'thinking'
              : 'idle'
  const failed =
    talk.is === 'failed' ? talk.reason : !running && !speaking.sentence && last?.outcome === 'failed' ? (last.problem ?? 'It could not answer.') : undefined

  // The core moves with the voice it hears, or the voice it speaks; with no sound, with the rhythm of syllables.
  const moods = useRef({ listening, voiceLevel })
  moods.current = { listening, voiceLevel }
  const level = useRef(() => (moods.current.listening ? heardLevel() : (moods.current.voiceLevel?.() ?? syllables())))

  // Starting to talk stops the assistant. The talk key (Ctrl+Space by default) starts listening, and again sends.
  const toggle = useCallback(() => {
    if (listening) return void finish()
    stop()
    void start()
  }, [listening, finish, start, stop])
  // Once the assistant can think, it greets the user when the app opens: the core decides whether it is time to.
  const greeted = useRef(false)
  const canThink = engines?.active !== undefined
  useEffect(() => {
    if (!canThink || greeted.current) return
    greeted.current = true
    client.channel.greet().catch(() => undefined)
  }, [canThink, client])

  // The app asks to talk when its global shortcut is pressed from another app.
  useEffect(() => {
    const onTalk = () => toggle()
    window.addEventListener(TALK_EVENT, onTalk)
    return () => window.removeEventListener(TALK_EVENT, onTalk)
  }, [toggle])
  // The key to talk inside the window is a setting of this device.
  const device = useDevice()
  const talkKey = device.settings.shortcuts.talkInWindow
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (talkKey !== '' && matchesShortcut(keyPress(event), talkKey, device.mac)) {
        event.preventDefault()
        toggle()
      } else if (event.key === 'Escape' && listening) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, listening, cancel, talkKey, device.mac])

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
      ) : running && last?.trigger === 'greeting' ? null : running && last ? (
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

  const asides =
    shown.margin.length > 0 || ready.length > 0 ? (
      <Asides
        cards={shown.margin}
        ready={ready}
        onFocus={(thread) => void client.threads.focus(thread).catch(() => undefined)}
        onClose={(id) => void client.view.clear(id).catch(() => undefined)}
        actions={actionsFor}
      />
    ) : undefined

  // Everything the assistant shows stays in one centred column: the core and its caption never move aside.
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
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-8 pb-6">
            <div className="mx-auto grid w-full max-w-5xl gap-4">
              {asides}
              <ViewPanel view={view} actions={actionsFor(view)} onClose={() => void client.view.clear().catch(() => undefined)} />
            </div>
          </div>
        </div>
      ) : (
        <div className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto px-8">
          <div className="my-auto flex w-full flex-col items-center py-4">
            <Orb size={asides ? 210 : 300} mood={mood} level={level.current} className="-my-6" />
            <div className="grid justify-items-center gap-1.5">
              <h1 className="font-medium text-4xl tracking-tight">{active.name}</h1>
              <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-300">
                {MOODS[mood]}
              </Eyebrow>
            </div>
            <div className={cn('mt-8 flex w-full max-w-2xl items-start justify-center text-center', asides ? 'min-h-10' : 'h-28')} aria-live="polite">
              {caption}
            </div>
            {asides ? (
              <div className="mt-4 w-full max-w-3xl">{asides}</div>
            ) : (
              // Until the user has said anything, a few things to try.
              !noEngine && !running && !speaking.sentence && channel.exchanges.every((line) => line.trigger !== undefined) && <Suggestions onSay={say} />
            )}
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-3xl gap-3 px-8 pb-7">
        <InputLine
          name={active.name}
          busy={running || speaking.sentence !== undefined}
          onSay={say}
          onStop={stop}
          pause={
            speaking.sentence || speaking.paused
              ? { paused: speaking.paused, onToggle: () => (speaking.paused ? client.speech.resume() : client.speech.pause()) }
              : undefined
          }
          talk={canTalk ? { listening, onPress: toggle } : onSetUpVoice ? { listening: false, onPress: onSetUpVoice } : undefined}
          persona={{
            name: active.name,
            next: other && other.id !== active.id ? { name: other.name, accent: other.accent } : undefined,
            onToggle: () => {
              if (other && other.id !== active.id) onSwitch(other.id).catch(() => setProblem(refusalCopy('failed')))
            }
          }}
        />
        {/* Which AI program answers: there to read, rarely to press. */}
        <div className="-mt-1 flex justify-end px-1">
          <AccessIndicator client={client} />
          <button
            type="button"
            onClick={onSetUpEngine}
            className="flex items-center gap-1.5 font-mono text-[0.625rem] text-text-faint/70 uppercase tracking-[0.12em] transition hover:text-text-soft"
          >
            <span className={cn('size-1 rounded-full', engines === undefined ? 'bg-text-faint/50' : noEngine ? 'bg-warn' : 'bg-ok/80')} />
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
