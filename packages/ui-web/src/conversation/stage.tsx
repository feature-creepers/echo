import type { Client } from '@repo/client'
import { matchesShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { PersonaId, Settings, ShownView, TurnId } from '@repo/protocol'
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccessIndicator } from '../access/access-indicator.tsx'
import { type Dropped, DropState, useWindowDrop } from '../attachments/drop-state.tsx'
import { useAttachments } from '../attachments/use-attachments.ts'
import type { SpeechEngine } from '../audio/engine.ts'
import { useTalk } from '../audio/use-talk.ts'
import { keyPress, useDevice } from '../device/device.tsx'
import { useLoad } from '../device/load.ts'
import { useShownPresence } from '../device/presence.ts'
import { usePlayer } from '../media/player-provider.tsx'
import { refusalCopy } from '../personas/copy.ts'
import { attendedView, useLingering } from '../presence/attention.ts'
import { middleOf } from '../presence/gaze.ts'
import { BANDS, type Mood } from '../presence/life.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { DURATION, EASE, settle } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { createPush, scrollsUnder, wheelTravel } from '../view/push.ts'
import { HOME_PEEK, ViewStream } from '../view/view-stream.tsx'
import { captionOf, useLastHeard } from './caption.ts'
import { EngineIndicator } from './engine-indicator.tsx'
import { GoArrow } from './go-arrow.tsx'
import { InputLine } from './input-line.tsx'
import { moodOf, moodWord } from './mood.ts'
import { ReadyChips } from './ready-chips.tsx'
import { RunningThreads } from './running-threads.tsx'
import { type ScrollEdges, useScrollEdges } from './scroll-edges.ts'
import { Caption } from './stage-caption.tsx'
import { Core, LARGEST, type Sight } from './stage-core.tsx'
import { Suggestions } from './suggestions.tsx'
import { TRAVEL } from './travel.ts'
import { useCoreViewActions } from './view-actions.ts'

interface StageProps {
  client: Client
  personas: Settings['personas']
  /** Make another persona the one that answers. */
  onSwitch(persona: PersonaId): Promise<void>
  /** Open the settings, on the engine, when the assistant has nothing to think with. */
  onSetUpEngine(): void
  /** Open the settings, on what the assistant may reach. */
  onOpenAccess(): void
  /** The device's speech engines. Left out, the person types and the assistant's sentences are only shown. */
  speech?: SpeechEngine | undefined
  /** How loud the assistant's voice is right now, when the device speaks it. */
  voiceLevel?: (() => number) | undefined
  /** The assistant's voice's spectrum right now, read into the bands given, when the device speaks it. */
  voiceBands?: ((into: Float32Array) => Float32Array | undefined) | undefined
  /** Open the voice settings, when the device could talk once its models are downloaded. */
  onSetUpVoice?: (() => void) | undefined
  /** Show the full answer a line's thread wrote, whole, in the side sheet. */
  onOpenAnswer(turn: TurnId): void
  /** Show a thread's work in the side sheet, or with none, the list of threads. */
  onOpenThread(thread: string | undefined): void
  /**
   * The window is Mini (docs/SPEC.md, section 13.2): the core and what it says alone, and the way back to the full
   * window. Left out, the full window.
   */
  mini?: { onFullWindow(): void } | undefined
}

/** The event an app dispatches on the window to start talking, or to send what was said: its global shortcut. */
export const TALK_EVENT = 'echo:talk'

/** The places the stage keeps for the core: the middle of an empty stage, home, the top of the column, and Mini. */
type CorePlace = 'empty' | 'home' | 'top' | 'mini'

/** The core's size in Mini: the largest it is at the top of the stage. */
const MINI_CORE = 136

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

/**
 * How firmly the person must scroll on down at home to go on to the stream: this many pixels of wheel within this
 * many milliseconds.
 */
const LEAVE = { far: 40, within: 450 } as const

/** How much of the stream shows at home, under the fade above the composer: a hint of what waits, not a second thing to read. */
const HOME_DIM = 0.45

/** The room between what is written under the core at home and the top of the view that waits under it. */
const HOME_AIR = 20

/** The spring the core travels on, for its name and its state, which go with it. */
const travel = { type: 'spring', stiffness: TRAVEL.stiffness, damping: TRAVEL.damping, mass: 1 } as const

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
 * Where the floating composer sits, kept current: the stream's box ends behind the middle of the composer, and the
 * cards fade out above the composer's top, half the composer up from there, so nothing is seen behind it. Measured
 * on the block that holds the composer and the row under it.
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
export function Stage({
  client,
  personas,
  onSwitch,
  onSetUpEngine,
  onOpenAccess,
  speech,
  voiceLevel,
  voiceBands,
  onSetUpVoice,
  onOpenAnswer,
  onOpenThread,
  mini
}: StageProps) {
  const inMini = mini !== undefined
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
  /** The sentence heard now, else the last one heard: the caption stays on what was said. */
  const heard = useLastHeard(speaking)
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
  // The cards of the stream can also snooze the reminder they show.
  const coreActions = useCoreViewActions(client, say)
  const actions = useMemo<ViewActions>(
    () => ({
      ...coreActions,
      snooze: (job: string, minutes: number) => client.session.run('schedule.snooze', { job, minutes }).then(() => undefined)
    }),
    [coreActions, client]
  )
  // Files and folders dropped anywhere on the main screen wait in the composer. A folder needs the desktop, which knows where it is.
  const device = useDevice()
  const dropping = useWindowDrop((dropped: Dropped) => {
    // Mini has no composer for them to wait in.
    if (inMini) return
    attachments.add(dropped.files, dropped.folders)
    if (dropped.unplaced > 0) attachments.refuse('A folder can be given only in the desktop app, which knows where it is.')
  }, device.host?.files?.pathOf)
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
    bands: heardBands,
    available: canTalk
  } = useTalk(speech, (text, language) => {
    setProblem(undefined)
    client.speech.stop()
    // Said aloud: a yes to what sends, pays or publishes counts only with the person's confirmation phrase. Said to
    // Mini, which shows no views, the assistant says a little more.
    client.channel.say(text, language, undefined, true, !inMini).catch(() => setProblem(refusalCopy('failed')))
  })
  const listening = talk.is === 'listening'
  // A tool at work for the answer: the core works rather than thinks.
  const tool = activity.running.at(-1)?.tool
  const [stageScroll, stageEdges] = useScrollEdges()
  const coreSize = useTopCoreSize()
  // With views, the stream has a notch above its newest view: home, where the core rests large in the middle as on
  // an empty stage and the newest view waits under it. The app opens there; scrolling on up past the newest view
  // goes back there; scrolling down, pressing the view that waits, or a new view arriving goes on to the stream.
  const [home, setHome] = useState(true)
  const newest = stream[0]?.id
  const newestArrived = newest !== undefined && shown.arrived.includes(newest)
  useEffect(() => {
    if (newestArrived) setHome(false)
  }, [newest, newestArrived])
  const atHome = streaming && home
  // The places kept for the core: it travels to the one in use and rests there.
  const places = useRef<Record<CorePlace, HTMLElement | null>>({ empty: null, home: null, top: null, mini: null })
  const keepers = useRef({
    empty: (element: HTMLElement | null) => {
      places.current.empty = element
    },
    home: (element: HTMLElement | null) => {
      places.current.home = element
    },
    top: (element: HTMLElement | null) => {
      places.current.top = element
    },
    mini: (element: HTMLElement | null) => {
      places.current.mini = element
    }
  })
  const keep = (where: CorePlace) => keepers.current[where]
  const placeIn = useRef<CorePlace>('empty')
  placeIn.current = inMini ? 'mini' : !streaming ? 'empty' : atHome ? 'home' : 'top'
  const placeOf = useCallback(() => places.current[placeIn.current], [])
  // What is written under the core waits for it to arrive, so it never crosses the core on its way.
  const [arrived, setArrived] = useState(true)
  // Whether the press under way is the one that went on from home to the stream.
  const wentOn = useRef(false)
  // At home, a push of the wheel on down, or a key that would go down, goes on to the stream. The window listens, as
  // nothing on the stage holds the keyboard; but only what happens on the stage counts, and only what nothing there
  // takes for itself: a wheel over the side sheet scrolls the sheet, and an arrow in a menu moves through the menu.
  useEffect(() => {
    // Mini shows no stream to go on to.
    if (!atHome || inMini) return
    const push = createPush(LEAVE.far, LEAVE.within)
    const stageOf = (target: EventTarget | null) => (target instanceof Element ? target.closest('[data-stage]') : null)
    const onWheel = (event: WheelEvent) => {
      const stage = stageOf(event.target)
      // The stream itself, sunk under the core, is what the push goes on to: it does not take the wheel from it.
      const free = stage !== null && !scrollsUnder(event.target, stage, 'down', stage.querySelector('[data-stream]'))
      if (push.wheel(wheelTravel(event), performance.now(), free)) setHome(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.key !== 'PageDown' && event.key !== 'ArrowDown' && event.key !== 'End')) return
      const target = event.target
      if (target instanceof Element && target !== document.body) {
        if (stageOf(target) === null) return
        if (target.closest('input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [role="dialog"]')) return
      }
      setHome(false)
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
    }
  }, [atHome, inMini])
  const [composerBox, composerRoom] = useComposerRoom()
  // How far the stage has gone home, from 0 in the stream to 1 at home, on the core's own spring: the stream sinks
  // under the core by it, so only the top of its newest view shows above the composer. The stream comes in where it
  // belongs, and only a change of place glides.
  const homing = useMotionValue(1)
  const streamed = useRef(false)
  useLayoutEffect(() => {
    if (!streaming) {
      streamed.current = false
      return
    }
    const target = atHome ? 1 : 0
    if (!streamed.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      streamed.current = true
      homing.jump(target)
      return
    }
    const glide = animate(homing, target, travel)
    return () => glide.stop()
  }, [streaming, atHome, homing])

  // What plays goes quiet while the person talks, so the music does not drown what they say.
  const player = usePlayer()
  useEffect(() => {
    player.duck('listening', listening)
    return () => player.duck('listening', false)
  }, [player, listening])
  const mood = moodOf({
    asleep,
    listening,
    transcribing: talk.is === 'transcribing',
    speaking: speaking.sentence !== undefined,
    running,
    voicing,
    tool
  })
  useShownPresence(active?.accent, mood)
  const word = moodWord(mood, tool)
  const failed =
    talk.is === 'failed' ? talk.reason : !running && !speaking.sentence && last?.outcome === 'failed' ? (last.problem ?? 'It could not answer.') : undefined

  // The core moves with the voice it hears, or the voice it speaks; with no sound, with the rhythm of syllables.
  const moods = useRef({ listening, voiceLevel })
  moods.current = { listening, voiceLevel }
  const level = useRef(() => (moods.current.listening ? heardLevel() : (moods.current.voiceLevel?.() ?? syllables())))
  // Its spectrum the same way; with no sound to read, the life makes one from the level.
  const spectrum = useRef(new Float32Array(BANDS))
  const voices = useRef({ heardBands, voiceBands })
  voices.current = { heardBands, voiceBands }
  const bands = useRef(() =>
    moods.current.listening ? voices.current.heardBands(spectrum.current) : moods.current.voiceLevel ? voices.current.voiceBands?.(spectrum.current) : undefined
  )
  const load = useLoad()

  // What the core looks at: the view it is talking about, else nothing, and it faces the front. It never follows the
  // pointer: an eye that chases the mouse is a toy.
  const spoken = speaking.sentence?.turn
  const attendedNow = attendedView(stream, spoken, channel.running, shown.arrived)
  const attended = useLingering(attendedNow, (id) => stream.some((view) => view.id === id))
  const looking = useRef(attended)
  looking.current = attended
  const sight = useCallback((): Sight | undefined => {
    const view = looking.current
    const card = view === undefined ? null : document.querySelector(`[data-view="${CSS.escape(view)}"]`)
    if (!card) return undefined
    const box = card.getBoundingClientRect()
    return box.bottom > 0 && box.top < window.innerHeight ? { point: middleOf(box), box } : undefined
  }, [])

  // Starting to talk stops the assistant. The talk key (Ctrl+Space by default) starts listening, and again sends.
  const toggle = useCallback(() => {
    if (listening) return void finish()
    stop()
    void start()
  }, [listening, finish, start, stop])
  // Once the assistant can think, it greets the person when the app opens: the core decides whether it is time to.
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
  const talkKey = device.settings.shortcuts.talkInWindow
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (talkKey !== '' && matchesShortcut(keyPress(event), talkKey, device.mac)) {
        event.preventDefault()
        toggle()
      } else if (event.key === 'Escape' && !event.defaultPrevented && listening) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, listening, cancel, talkKey, device.mac])

  // What the stream held when the window became Mini: a view that arrived since is kept there, and waits unseen for the
  // full window.
  const seenInFull = useRef<readonly string[]>([])
  if (!inMini) seenInFull.current = stream.map((view) => view.id)
  const unseen = inMini && stream.some((view) => !seenInFull.current.includes(view.id))

  if (!active) return null

  // Over the stream and in Mini, what is said is smaller; at home and on an empty stage, as large as the core is.
  const compact = inMini || (streaming && !home)
  const line = captionOf({
    hearing: speaking.sentence !== undefined,
    busy: running || voicing,
    last: last && {
      request: last.trigger !== 'greeting' && last.trigger !== 'reminder' && last.trigger !== 'ready',
      heard: heard?.sentence.turn === last.turn,
      replied: last.replied !== ''
    },
    problem: failed !== undefined || problem !== undefined
  })
  const caption = (
    <Caption
      line={line}
      heard={heard}
      last={last}
      paused={speaking.paused}
      compact={compact}
      problem={failed ?? problem}
      onSetUpEngine={noEngine ? onSetUpEngine : undefined}
    />
  )
  const core = <Core mood={mood} level={level.current} bands={bands.current} load={load} sight={sight} place={placeOf} onArrive={setArrived} />

  // Mini: the core alone in the middle, its name, state and what it says under it, and nothing else of the stage.
  // The core stays first, so it is the same core, never drawn again, when the window goes from one layout to the
  // other. Pressing it talks, as the talk key does; every button here is pressed, and the ground round them drags the
  // window.
  if (mini) {
    const press = canTalk ? toggle : onSetUpVoice
    return (
      <div data-stage="" className="relative flex h-full min-w-0 flex-col">
        {core}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe px-4 pb-4 text-center [&_button]:no-drag">
          <button
            ref={keep('mini')}
            type="button"
            aria-label={listening ? 'Send' : 'Talk'}
            disabled={press === undefined}
            onClick={press}
            className="shrink-0 rounded-full"
            style={{ width: MINI_CORE, height: MINI_CORE, marginBlock: -Math.round(MINI_CORE * 0.1) }}
          />
          <span className="mt-1.5 font-semibold text-[1.0625rem] leading-tight tracking-[-0.015em]">{active.name}</span>
          <span className="mt-1">
            <MoodWord mood={mood} word={word} />
          </span>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: arrived ? 1 : 0 }}
            transition={{ duration: arrived ? DURATION.calm : DURATION.quick, ease: EASE }}
            className="mt-2 grid min-h-[3.25rem] w-full justify-items-center"
            aria-live="polite"
          >
            {caption}
          </motion.div>
          {/* A view that arrived here is kept in the stream: the way to it, in the full window. */}
          <AnimatePresence initial={false}>
            {unseen && (
              <motion.button
                key="unseen"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
                transition={settle}
                onClick={() => {
                  setHome(false)
                  mini.onFullWindow()
                }}
                className="group mt-1 inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-text-faint text-xs transition-colors duration-(--duration-quick) hover:text-text-soft"
              >
                Shown in the full window
                <GoArrow />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

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
    <div data-stage="" className="relative flex h-full min-w-0 flex-col">
      {core}
      {streaming && (
        <header className="relative z-10 shrink-0 px-8 pt-1">
          <div className={cn('mx-auto grid w-full justify-items-center text-center', COLUMN)}>
            {/* At home, the core, its name and its state glide to the middle of the stage, and their places here stay
                kept, so the stream under them never moves. */}
            <div ref={keep('top')} aria-hidden="true" style={{ width: coreSize, height: coreSize, marginBlock: -Math.round(coreSize * 0.1) }} />
            <motion.span
              {...(atHome ? {} : { layoutId: 'stage-name' })}
              transition={travel}
              className={cn('mt-1.5 font-semibold text-[1.0625rem] leading-tight tracking-[-0.015em]', atHome && 'invisible')}
            >
              {active.name}
            </motion.span>
            <motion.span {...(atHome ? {} : { layoutId: 'stage-mood' })} transition={travel} className={cn('mt-1', atHome && 'invisible')}>
              <MoodWord mood={mood} word={word} />
            </motion.span>
            {/* Two lines are kept for what is said, and every line shown there holds to them, so it never moves the
                stream under it nor runs onto the chips. Only a problem may take more room, and then pushes the chips
                down rather than covering them. They come in once the core, rising from the middle of the screen, has
                passed where they are. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: atHome || !arrived ? 0 : 1 }}
              transition={{ duration: arrived ? DURATION.calm : DURATION.quick, ease: EASE }}
              className="mt-3 grid w-full justify-items-center gap-1"
            >
              <div className="relative w-full max-w-[38rem]">
                <div className="min-h-[3.25rem] text-text" aria-live={atHome ? undefined : 'polite'}>
                  {!atHome && caption}
                </div>
                {/* Under the two lines kept for what is said, over the room above the stream, so it moves nothing. With
                    topics ready, it sits in their row instead. */}
                {!chips && !atHome && <div className="absolute inset-x-0 top-full flex justify-center">{answerLink}</div>}
              </div>
              {!atHome && chips}
            </motion.div>
          </div>
        </header>
      )}
      {/* Home: the core large in the middle, its name, its state and what it says under it, as on an empty stage,
          over the stream, which waits further down. */}
      {atHome && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center px-8"
          style={{ bottom: composerRoom.end + composerRoom.under + HOME_PEEK + HOME_AIR }}
        >
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
            <div ref={keep('home')} aria-hidden="true" className="-my-7" style={{ width: LARGEST, height: LARGEST }} />
            <Presence name={active.name} mood={mood} word={word} />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: arrived ? 1 : 0 }}
              transition={{ duration: arrived ? DURATION.calm : DURATION.quick, ease: EASE }}
              className={cn('pointer-events-auto mt-7 flex min-h-[5.5rem] w-full flex-col items-center gap-1.5 text-center', COLUMN)}
            >
              <div className="flex w-full justify-center" aria-live="polite">
                {caption}
              </div>
              {chips ?? answerLink}
            </motion.div>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {streaming && (
            <motion.div
              key="stream"
              className="absolute inset-x-0 top-0"
              style={{ bottom: composerRoom.end }}
              // At home, the stream dims under the core, and sinks there by the dial's own measure; pressing the view
              // that waits goes on to it.
              initial={false}
              animate={{ opacity: atHome ? HOME_DIM : 1 }}
              transition={travel}
              exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
              onPointerDownCapture={(event) => {
                if (!atHome) return
                event.preventDefault()
                event.stopPropagation()
                // The press that goes on to the stream is only that: the click it ends in never also presses what
                // was under it. Once the pointer is let go, and that click has come or not, presses count again.
                wentOn.current = true
                const done = () => {
                  window.removeEventListener('pointerup', done)
                  window.removeEventListener('pointercancel', done)
                  setTimeout(() => {
                    wentOn.current = false
                  }, 0)
                }
                window.addEventListener('pointerup', done)
                window.addEventListener('pointercancel', done)
                setHome(false)
              }}
              onClickCapture={(event) => {
                if (!wentOn.current) return
                wentOn.current = false
                event.preventDefault()
                event.stopPropagation()
              }}
              // From the keyboard too: at home, Enter or Space on what waits in the stream goes on to it first.
              onKeyDownCapture={(event) => {
                if (!atHome || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                event.stopPropagation()
                setHome(false)
              }}
            >
              <ViewStream
                className="h-full"
                views={stream}
                arrived={shown.arrived}
                attended={attended}
                actions={actionsFor}
                onClose={close}
                under={composerRoom.under}
                home={homing}
                onPastTop={() => setHome(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {!streaming && (
          <div ref={stageScroll} className={cn('scroll-none h-full overflow-y-auto px-8', fade(stageEdges))}>
            <div className="flex min-h-full w-full flex-col items-center justify-center pt-6 pb-32">
              <div ref={keep('empty')} aria-hidden="true" className="-my-7" style={{ width: LARGEST, height: LARGEST }} />
              <Presence name={active.name} mood={mood} word={word} />
              <div className={cn('mt-7 flex min-h-[6.75rem] w-full flex-col items-center gap-1.5 text-center', COLUMN)}>
                <div className="flex w-full justify-center" aria-live="polite">
                  {caption}
                </div>
                {!chips && answerLink}
              </div>
              {chips ? (
                <div className={cn('mt-2 w-full', COLUMN)}>{chips}</div>
              ) : (
                // Until the person has said anything, a few things to try.
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
              onOpen={onOpenThread}
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
              <AccessIndicator client={client} onOpenSettings={onOpenAccess} />
              <EngineIndicator client={client} onOpenSettings={onSetUpEngine} />
            </div>
          </div>
        </div>
      </div>
      <DropState over={dropping} name={active.name} />
    </div>
  )
}

/** What the core is doing, in a word, lit in the accent unless it is simply ready. */
function MoodWord({ mood, word }: { mood: Mood; word: string }) {
  return (
    <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-(--duration-calm)">
      {word}
    </Eyebrow>
  )
}

/**
 * The persona's name and what it is doing, large under the core in the middle of the stage: at home and on an empty
 * stage. They glide to and from their places over the stream with the core.
 */
function Presence({ name, mood, word }: { name: string; mood: Mood; word: string }) {
  return (
    <div className="grid justify-items-center gap-2">
      <motion.h1 layoutId="stage-name" transition={travel} className="font-semibold text-[1.875rem] leading-none tracking-[-0.025em]">
        {name}
      </motion.h1>
      <motion.span layoutId="stage-mood" transition={travel}>
        <MoodWord mood={mood} word={word} />
      </motion.span>
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
      <GoArrow />
    </motion.button>
  )
}
