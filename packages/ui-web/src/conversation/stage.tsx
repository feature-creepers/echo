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
import { DURATION, EASE, glide, settle } from '../styles/motion.ts'
import { Asides } from '../view/asides.tsx'
import type { ViewActions } from '../view/context.ts'
import { ViewPanel } from '../view/view-panel.tsx'
import { doing } from './activity.ts'
import { InputLine } from './input-line.tsx'
import { type ScrollEdges, useScrollEdges } from './scroll-edges.ts'
import { SpokenLine } from './spoken-line.tsx'
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

/** The width of the centred column, for everything the assistant shows and for the composer. */
const COLUMN = 'max-w-[45rem]'

/**
 * How what scrolls fades out where it is cut: under the header when scrolled, and just above the composer, which
 * floats over the bottom of the screen, when there is more below. Nothing is painted behind the composer, so the
 * window's ground runs under it as everywhere else. The fade above the composer starts over the room the content
 * keeps under it (pb-32), so what rests at the bottom is whole.
 */
const FADES = {
  none: '',
  above: '[mask-image:linear-gradient(to_bottom,transparent,black_20px)]',
  below: '[mask-image:linear-gradient(to_bottom,black_calc(100%-7.75rem),transparent_calc(100%-5.75rem))]',
  both: '[mask-image:linear-gradient(to_bottom,transparent,black_20px,black_calc(100%-7.75rem),transparent_calc(100%-5.75rem))]'
} as const
const fade = ({ above, below }: ScrollEdges) => FADES[above ? (below ? 'both' : 'above') : below ? 'below' : 'none']

const MOODS: Record<Mood, string> = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', asleep: 'Asleep' }

/** How strongly the light around the core shows in each mood: brighter while it hears or speaks, dim asleep. */
const HALO: Record<Mood, number> = { idle: 0.7, listening: 1, thinking: 0.85, speaking: 1, asleep: 0.3 }

/**
 * The core with the soft light it casts on the ground around it: the accent, faint, fading to nothing well
 * before any edge. It follows the core wherever it goes and only changes in opacity, so it costs no layout.
 */
function Core({ size, mood, level }: { size: number; mood: Mood; level: () => number }) {
  return (
    <div className="relative">
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ opacity: HALO[mood] }}
        transition={{ duration: DURATION.slow * 2, ease: EASE }}
        className="pointer-events-none absolute -inset-[42%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_15%,transparent),color-mix(in_oklab,var(--accent)_6%,transparent)_45%,transparent)]"
      />
      <Orb size={size} mood={mood} level={level} className="relative" />
    </div>
  )
}

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
  const activity = useFollowed(client.activity)
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
  /** Sentences whose sound is still being made: the voice is about to speak. */
  const voicing = speaking.sentence !== undefined || speaking.waiting > 0
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
  const [viewScroll, viewEdges] = useScrollEdges()
  const [stageScroll, stageEdges] = useScrollEdges()

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
            : running || voicing
              ? 'thinking'
              : 'idle'
  // While it thinks, the word under the core says what it is doing: searching the web, preparing the view.
  const moodWord = (mood === 'thinking' ? doing(activity.running.at(-1)?.tool) : undefined) ?? MOODS[mood]
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
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          // A sentence leaves quickly, so the next one is shown as its sound starts.
          exit={{ opacity: 0, y: -3, transition: { duration: 0.12 } }}
          transition={settle}
          className={cn('text-balance', view ? 'text-[0.9375rem] leading-relaxed' : 'text-xl leading-snug tracking-[-0.01em]')}
        >
          <SpokenLine text={speaking.sentence.text} since={speaking.since} seconds={speaking.seconds} paused={speaking.paused} />
        </motion.p>
      ) : (running || voicing) && last?.trigger === 'greeting' ? null : (running || voicing) && last ? (
        <motion.p
          key={`said:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          className={cn('text-balance text-text-faint', view ? 'text-[0.9375rem] leading-relaxed' : 'text-lg leading-snug')}
        >
          “{last.said}”
        </motion.p>
      ) : failed || problem ? (
        <motion.div key="problem" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid justify-items-center gap-3">
          <p className="text-balance text-danger text-sm leading-relaxed">{failed ?? problem}</p>
          {noEngine && (
            <button type="button" onClick={onSetUpEngine} className="w-fit text-accent text-xs hover:underline hover:underline-offset-4">
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
          className={cn('line-clamp-3 text-balance text-text-soft', view ? 'text-[0.9375rem] leading-relaxed' : 'text-lg leading-snug')}
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

  const composer = (
    <InputLine
      name={active.name}
      busy={running || voicing}
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
        mood,
        next: other && other.id !== active.id ? { name: other.name } : undefined,
        onToggle: () => {
          if (other && other.id !== active.id) onSwitch(other.id).catch(() => setProblem(refusalCopy('failed')))
        }
      }}
    />
  )

  // Everything the assistant shows stays in one column, centred in the window: the core and its caption never move
  // aside. With a view on the stage, the core only shrinks and rises to the top of the column, its name, state and
  // spoken line centred under it. The sides of the window are left to the pinned widgets' docks.
  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {view ? (
        <>
          <header className="relative z-10 shrink-0 px-8 pt-1.5 pb-2">
            <div className={cn('mx-auto grid w-full justify-items-center text-center', COLUMN)}>
              <motion.div layoutId="stage-core" transition={glide} className="-my-1.5">
                <Core size={64} mood={mood} level={level.current} />
              </motion.div>
              <motion.span layoutId="stage-name" transition={glide} className="mt-1 font-semibold text-[0.9375rem] leading-tight tracking-tight">
                {active.name}
              </motion.span>
              <motion.span layoutId="stage-mood" transition={glide} className="mt-0.5">
                <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-(--duration-calm)">
                  {moodWord}
                </Eyebrow>
              </motion.span>
              <div className="mt-1.5 min-h-6 max-w-[38rem] text-text" aria-live="polite">
                {caption}
              </div>
            </div>
          </header>
          <div className="relative min-h-0 flex-1">
            <div ref={viewScroll} className={cn('scroll-none h-full overflow-y-auto px-8 pt-2 pb-32', fade(viewEdges))}>
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.slow, ease: EASE }}
                className={cn('mx-auto grid w-full gap-3', COLUMN)}
              >
                {asides}
                <ViewPanel view={view} actions={actionsFor(view)} onClose={() => void client.view.clear().catch(() => undefined)} />
              </motion.div>
            </div>
          </div>
        </>
      ) : (
        <div ref={stageScroll} className={cn('scroll-none min-h-0 flex-1 overflow-y-auto px-8', fade(stageEdges))}>
          <div className="flex min-h-full w-full flex-col items-center justify-center pt-6 pb-32">
            <motion.div layoutId="stage-core" transition={glide} className={asides ? '-my-4' : '-my-7'}>
              <Core size={asides ? 200 : 280} mood={mood} level={level.current} />
            </motion.div>
            <div className="grid justify-items-center gap-2">
              <motion.h1 layoutId="stage-name" transition={glide} className="font-semibold text-[1.875rem] leading-none tracking-[-0.025em]">
                {active.name}
              </motion.h1>
              <motion.span layoutId="stage-mood" transition={glide}>
                <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-(--duration-calm)">
                  {moodWord}
                </Eyebrow>
              </motion.span>
            </div>
            <div className={cn('mt-7 flex w-full items-start justify-center text-center', COLUMN, asides ? 'min-h-8' : 'min-h-24')} aria-live="polite">
              {caption}
            </div>
            {asides ? (
              <div className={cn('mt-4 w-full', COLUMN)}>{asides}</div>
            ) : (
              // Until the user has said anything, a few things to try.
              !noEngine && !running && !speaking.sentence && channel.exchanges.every((line) => line.trigger !== undefined) && <Suggestions onSay={say} />
            )}
          </div>
        </div>
      )}

      {/* The composer floats over the bottom of the screen; what scrolls fades out above it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-8 pb-4">
        <div className={cn('pointer-events-auto mx-auto grid w-full gap-1.5', COLUMN)}>
          {composer}
          {/* Which AI program answers: there to read, rarely to press. */}
          <div className="flex justify-end px-1">
            <AccessIndicator client={client} />
            <button
              type="button"
              onClick={onSetUpEngine}
              className="flex h-4 items-center gap-1.5 text-[0.6875rem] text-text-faint transition-colors duration-(--duration-quick) hover:text-text-soft"
            >
              <span className={cn('size-1.5 rounded-full', engines === undefined ? 'bg-text-faint/50' : noEngine ? 'bg-warn' : 'bg-ok/80')} />
              {engines === undefined
                ? 'Looking…'
                : noEngine
                  ? 'No AI program ready'
                  : (engines.harnesses.find((harness) => harness.id === engines.active)?.name ?? 'Ready')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
