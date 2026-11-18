import type { Client } from '@repo/client'
import { matchesShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { PersonaId, Settings, ShownView, TurnId } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessIndicator } from '../access/access-indicator.tsx'
import { type Dropped, DropState, useWindowDrop } from '../attachments/drop-state.tsx'
import { useAttachments } from '../attachments/use-attachments.ts'
import type { SpeechEngine } from '../audio/engine.ts'
import { useTalk } from '../audio/use-talk.ts'
import { keyPress, useDevice } from '../device/device.tsx'
import { useShownPresence } from '../device/presence.ts'
import { useFileActions } from '../files/file-actions.ts'
import { usePlayer } from '../media/player-provider.tsx'
import { refusalCopy } from '../personas/copy.ts'
import { Orb } from '../presence/orb.tsx'
import type { Mood } from '../presence/painter.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { ArrowGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, glide, settle } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewStream } from '../view/view-stream.tsx'
import { doing } from './activity.ts'
import { EngineIndicator } from './engine-indicator.tsx'
import { InputLine } from './input-line.tsx'
import { ReadyChips } from './ready-chips.tsx'
import { RunningThreads } from './running-threads.tsx'
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
  /** Show the full answer a line's thread wrote, whole, in the side sheet. */
  onOpenAnswer(turn: TurnId): void
}

/** The event an app dispatches on the window to start talking, or to send what was said: its global shortcut. */
export const TALK_EVENT = 'echo:talk'

/** The width of the centred column, for everything the assistant shows and for the composer. */
const COLUMN = 'max-w-[45rem]'

/**
 * How the empty stage fades out where it is cut, in a window too short for it: at the top when scrolled, and just
 * above the composer, which floats over the bottom of the screen, when there is more below. Nothing is painted
 * behind the composer, so the window's ground runs under it as everywhere else. The fade above the composer starts
 * over the room the content keeps under it (pb-32), so what rests at the bottom is whole.
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
 * The core's size over the stream: large enough to read as the presence at the top of the screen, small enough to
 * leave the stream its room in a short window.
 */
const topCoreSize = (height: number) => Math.round(Math.min(136, Math.max(96, height * 0.12)))

function useTopCoreSize(): number {
  const [size, setSize] = useState(() => topCoreSize(window.innerHeight))
  useEffect(() => {
    const onResize = () => setSize(topCoreSize(window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Where the floating composer sits, kept current: the stream's box ends behind the middle of the composer, so the
 * edge where it cuts the cards is under the composer's material, and the top half of the composer is what the
 * cards sink under. Measured on the block that holds the composer and the row under it.
 */
function useComposerRoom(): [(element: HTMLElement | null) => void, { end: number; under: number }] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [room, setRoom] = useState({ end: 66, under: 24 })
  useEffect(() => {
    if (!element) return
    const measure = () => {
      const composer = element.querySelector('form')
      const half = Math.round((composer?.offsetHeight ?? 48) / 2)
      const end = Math.round(element.offsetHeight) - half
      setRoom((was) => (was.end === end && was.under === half ? was : { end, under: half }))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return [setElement, room]
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
export function Stage({ client, personas, onSwitch, onSetUpEngine, speech, voiceLevel, onSetUpVoice, onOpenAnswer }: StageProps) {
  const channel = useFollowed(client.channel)
  const speaking = useFollowed(client.speech)
  const activity = useFollowed(client.activity)
  const engines = useFollowed(client.engines)
  const shown = useFollowed(client.view)
  const stream = shown.stream
  const streaming = stream.length > 0
  const threads = useFollowed(client.threads)
  const asleep = useFollowed(client.memory.asleep)
  const ready = threads.threads.filter((thread) => thread.state === 'ready')
  /** The threads at work, behind or on the stage: each goes on while the person asks for something else. */
  const working = threads.threads.filter((thread) => thread.state === 'working').length
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
  // What the composer sends goes with the files and folders waiting in it, once they have all arrived.
  const attachments = useAttachments(client)
  const send = useCallback(
    async (text: string) => {
      setProblem(undefined)
      client.speech.stop()
      const handed = attachments.pending.length > 0 ? await attachments.take() : {}
      if (handed === undefined) return false
      client.channel.say(text, undefined, handed).catch(() => setProblem(refusalCopy('failed')))
      return true
    },
    [client, attachments]
  )
  const files = useFileActions()
  const actions = useMemo(
    () => ({
      say,
      readFile: (file: string) => client.session.run('file.read', { file }),
      readShapes: (url: string) => client.session.run('shapes.read', { url }).then((read) => read.shapes),
      readFeed: (url: string) => client.session.run('feed.read', { url }).then((read) => read.document),
      act: (act: readonly Record<string, unknown>[]) => client.session.run('view.act', { act: [...act] }).then(() => undefined),
      files
    }),
    [say, client, files]
  )
  // Files and folders dropped anywhere on the main screen wait in the composer. A folder needs the desktop, which knows where it is.
  const { host } = useDevice()
  const dropping = useWindowDrop((dropped: Dropped) => {
    attachments.add(dropped.files, dropped.folders)
    if (dropped.unplaced > 0) attachments.refuse('A folder can be given only in the desktop app, which knows where it is.')
  }, host?.files?.pathOf)
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
  // Closing a card takes it out of the stream, and off the stage when it is the one there.
  const close = useCallback((view: ShownView) => void client.view.clear(view.id).catch(() => undefined), [client])
  const stop = useCallback(() => {
    client.speech.stop()
    client.channel.stop().catch(() => undefined)
  }, [client])
  // Held to the end, the composer's stop ends all work: every thread's, and the answer on the stage.
  const stopAll = useCallback(() => {
    client.speech.stop()
    client.threads.stop().catch(() => setProblem(refusalCopy('failed')))
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
    // Said aloud: a yes to what sends, pays or publishes counts only with the person's confirmation phrase.
    client.channel.say(text, language, undefined, true).catch(() => setProblem(refusalCopy('failed')))
  })
  const listening = talk.is === 'listening'
  const [stageScroll, stageEdges] = useScrollEdges()
  const coreSize = useTopCoreSize()
  const [composerBox, composerRoom] = useComposerRoom()

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
  useShownPresence(active?.accent, mood)
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
          className={cn('text-balance', streaming ? 'text-[0.9375rem] leading-relaxed' : 'text-xl leading-snug tracking-[-0.01em]')}
        >
          <SpokenLine text={speaking.sentence.text} since={speaking.since} seconds={speaking.seconds} paused={speaking.paused} />
        </motion.p>
      ) : (running || voicing) && (last?.trigger === 'greeting' || last?.trigger === 'reminder') ? null : (running || voicing) && last ? (
        <motion.p
          key={`said:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          className={cn('text-balance text-text-faint', streaming ? 'line-clamp-2 text-[0.9375rem] leading-relaxed' : 'text-lg leading-snug')}
        >
          {last.trigger === 'task' && <span className="text-label">Scheduled · </span>}
          {last.trigger === 'resume' && <span className="text-label">Resumed · </span>}
          {/* Files handed over without a word are named instead. */}
          {last.said === '' ? (last.attached?.map((one) => one.name).join(', ') ?? '') : `“${last.said}”`}
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
          // Over the stream, two lines at most: the room kept for the caption, so it never runs onto the cards.
          className={cn('text-balance text-text-soft', streaming ? 'line-clamp-2 text-[0.9375rem] leading-relaxed' : 'line-clamp-3 text-lg leading-snug')}
        >
          {last.replied}
        </motion.p>
      ) : null}
    </AnimatePresence>
  )

  // The last reply's full answer, when its thread wrote one: a quiet link under what is said opens it whole.
  const written = last?.written !== undefined && !failed && !problem ? last.turn : undefined
  const answerLink = (
    <AnimatePresence initial={false}>{written !== undefined && <FullAnswerLink key={written} onOpen={() => onOpenAnswer(written)} />}</AnimatePresence>
  )
  const chips =
    ready.length > 0 ? (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ReadyChips ready={ready} onFocus={(thread) => void client.threads.focus(thread).catch(() => undefined)} />
        {answerLink}
      </div>
    ) : undefined

  const composer = (
    <InputLine
      name={active.name}
      stopAll={running || voicing || working > 0 ? { working: Math.max(working, 1), onStop: stopAll } : undefined}
      onSay={send}
      onStop={stop}
      attachments={attachments}
      pause={
        speaking.sentence || speaking.paused
          ? { paused: speaking.paused, onToggle: () => (speaking.paused ? client.speech.resume() : client.speech.pause()) }
          : undefined
      }
      talk={canTalk ? { listening, onPress: toggle } : onSetUpVoice ? { listening: false, onPress: onSetUpVoice } : undefined}
      persona={{
        name: active.name,
        look: active.look,
        mood,
        next: other && other.id !== active.id ? { name: other.name } : undefined,
        onToggle: () => {
          if (other && other.id !== active.id) onSwitch(other.id).catch(() => setProblem(refusalCopy('failed')))
        }
      }}
    />
  )

  // Everything the assistant shows stays in one column, centred in the window: the core and its caption never move
  // aside. With views to show, the core rises to the top of the column, its name, state and spoken line centred under
  // it, and the stream of views turns under them. The sides of the window are left to the pinned widgets' docks.
  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {streaming && (
        <header className="relative z-10 shrink-0 px-8 pt-1">
          <div className={cn('mx-auto grid w-full justify-items-center text-center', COLUMN)}>
            <motion.div layoutId="stage-core" transition={glide} style={{ marginBlock: -Math.round(coreSize * 0.1) }}>
              <Core size={coreSize} mood={mood} level={level.current} />
            </motion.div>
            <motion.span layoutId="stage-name" transition={glide} className="mt-1.5 font-semibold text-[1.0625rem] leading-tight tracking-[-0.015em]">
              {active.name}
            </motion.span>
            <motion.span layoutId="stage-mood" transition={glide} className="mt-1">
              <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-(--duration-calm)">
                {moodWord}
              </Eyebrow>
            </motion.span>
            {/* Two lines are kept for what is said, so a longer sentence never moves the stream under it. They come in
                once the core, rising from the middle of the screen, has passed where they are. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION.calm, delay: 0.18, ease: EASE }}
              className="mt-3 grid w-full justify-items-center gap-1"
            >
              <div className="relative w-full max-w-[38rem]">
                <div className="h-[3.25rem] text-text" aria-live="polite">
                  {caption}
                </div>
                {/* Under the two lines kept for what is said, over the room above the stream, so it moves nothing. With
                    topics ready, it sits in their row instead. */}
                {!chips && <div className="absolute inset-x-0 top-full flex justify-center">{answerLink}</div>}
              </div>
              {chips}
            </motion.div>
          </div>
        </header>
      )}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {streaming && (
            <motion.div
              key="stream"
              className="absolute inset-x-0 top-0"
              style={{ bottom: composerRoom.end }}
              exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
            >
              <ViewStream className="h-full" views={stream} arrived={shown.arrived} actions={actionsFor} onClose={close} under={composerRoom.under} />
            </motion.div>
          )}
        </AnimatePresence>
        {!streaming && (
          <div ref={stageScroll} className={cn('scroll-none h-full overflow-y-auto px-8', fade(stageEdges))}>
            <div className="flex min-h-full w-full flex-col items-center justify-center pt-6 pb-32">
              <motion.div layoutId="stage-core" transition={glide} className="-my-7">
                <Core size={280} mood={mood} level={level.current} />
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
              <div className={cn('mt-7 flex min-h-[6.75rem] w-full flex-col items-center gap-1.5 text-center', COLUMN)}>
                <div className="flex w-full justify-center" aria-live="polite">
                  {caption}
                </div>
                {!chips && answerLink}
              </div>
              {chips ? (
                <div className={cn('mt-2 w-full', COLUMN)}>{chips}</div>
              ) : (
                // Until the user has said anything, a few things to try.
                !noEngine && !running && !speaking.sentence && channel.exchanges.every((line) => line.trigger !== undefined) && <Suggestions onSay={say} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* The composer floats over the bottom of the screen; the stream turns under it, and what sinks fades out there. */}
      <div ref={composerBox} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-8 pb-4">
        <div className={cn('pointer-events-auto mx-auto grid w-full gap-1.5', COLUMN)}>
          {composer}
          {/* Why a file was not added, quietly on the left; what it may reach and what it thinks with on the right, changed
              on the spot from their menus. */}
          <div className="-mt-0.5 flex items-start justify-between gap-4">
            <RunningThreads
              threads={threads.threads}
              exchanges={channel.exchanges}
              onFocus={(thread) => void client.threads.focus(thread).catch(() => undefined)}
              onStop={(thread) => void client.threads.stop(thread).catch(() => setProblem(refusalCopy('failed')))}
            />
            <AnimatePresence>
              {attachments.notice && (
                <motion.span
                  key={attachments.notice}
                  role="status"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DURATION.calm, ease: EASE }}
                  className="min-w-0 pt-1 pl-1 text-text-soft text-xs leading-snug"
                >
                  {attachments.notice}
                </motion.span>
              )}
            </AnimatePresence>
            <div className="ml-auto flex shrink-0 gap-2">
              <AccessIndicator client={client} />
              <EngineIndicator client={client} onOpenSettings={onSetUpEngine} />
            </div>
          </div>
        </div>
      </div>
      <DropState over={dropping} name={active.name} />
    </div>
  )
}

/** The way to the full answer of the last reply: a quiet link, there when the reply has more to it than was said. */
function FullAnswerLink({ onOpen }: { onOpen(): void }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
      transition={settle}
      onClick={onOpen}
      className="group inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-text-faint text-xs transition-colors duration-(--duration-quick) hover:text-text-soft"
    >
      Full answer
      <span className="transition-transform duration-(--duration-quick) ease-soft group-hover:translate-x-0.5 [&_svg]:size-3">
        <ArrowGlyph />
      </span>
    </motion.button>
  )
}
