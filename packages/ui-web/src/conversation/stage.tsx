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
import { useLoad } from '../device/load.ts'
import { useShownPresence } from '../device/presence.ts'
import { DOCK_ROOM } from '../library/pinned-docks.tsx'
import { usePlayer } from '../media/player-provider.tsx'
import { refusalCopy } from '../personas/copy.ts'
import { attendedView, useLingering } from '../presence/attention.ts'
import { middleOf } from '../presence/gaze.ts'
import { BANDS, type Mood } from '../presence/life.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { DURATION, EASE, settle } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { BOARD, type GroupVersion, type ViewGroup } from '../view/groups.ts'
import { type GroupWords, ViewBoard } from '../view/view-board.tsx'
import { captionOf, useLastHeard } from './caption.ts'
import { EngineIndicator } from './engine-indicator.tsx'
import { GoArrow } from './go-arrow.tsx'
import { InputLine } from './input-line.tsx'
import { moodOf, moodWord } from './mood.ts'
import { ReadyTopics } from './ready-topics.tsx'
import { RunningThreads } from './running-threads.tsx'
import { type ScrollEdges, useScrollEdges } from './scroll-edges.ts'
import { Caption, OneLine } from './stage-caption.tsx'
import { Core, LARGEST, type Sight } from './stage-core.tsx'
import { Suggestions } from './suggestions.tsx'
import { usedWords } from './thread-list.tsx'
import { TRAVEL } from './travel.ts'
import { useCoreViewActions } from './view-actions.ts'
import { whoAsked } from './who-asked.ts'

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
  /** The pinned widgets stand in their docks on both sides of the screen: the board takes the room between them. */
  docked?: boolean | undefined
}

/** The event an app dispatches on the window to start talking, or to send what was said: its global shortcut. */
export const TALK_EVENT = 'echo:talk'

/** The places the stage keeps for the core: the middle of an empty stage, the top left of the board, and Mini. */
type CorePlace = 'empty' | 'board' | 'mini'

/** The core's size in Mini: the largest it is at the top of the stage. */
const MINI_CORE = 136

/** The width of the centred column of the empty stage: its caption and what it suggests. */
const COLUMN = 'max-w-[45rem]'

/** The board's column, which its header and the composer share, so their edges line up. */
const BOARD_COLUMN = { maxWidth: BOARD.most } as const

/**
 * The core's square at the top left of the board. The core fills about seven tenths of its square, so it shows about
 * 40 px wide; the square spills over its neighbours by this much on each side, so the core takes only that room.
 */
const BOARD_CORE = { square: 56, spill: 8 } as const

/** The room kept on each side of the board: from the window's edges, or from the pinned docks beside it. */
const BOARD_SIDE = { free: 24, docked: DOCK_ROOM + 16 } as const

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

/** The spring the core travels on, for its name and its state, which go with it. */
const travel = { type: 'spring', stiffness: TRAVEL.stiffness, damping: TRAVEL.damping, mass: 1 } as const

/**
 * How much room the floating composer takes at the bottom of the stage, kept current: the board ends above it, so
 * nothing of a card is seen behind it. Measured on the block that holds the composer and the row under it.
 */
function useComposerRoom(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [room, setRoom] = useState(96)
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(() => setRoom(Math.round(element.offsetHeight)))
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
  mini,
  docked = false
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
      client.channel.say(text, { handed }).catch(() => setProblem(refusalCopy('failed')))
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
  // What a group of the board says over its cards: when its answer was asked for and in what words, else its topic.
  const describe = useCallback(
    (group: ViewGroup, version: GroupVersion): GroupWords => {
      const exchange = version.turn === undefined ? undefined : channel.exchanges.find((line) => line.turn === version.turn)
      const topic = group.thread === undefined ? undefined : threads.threads.find((one) => one.id === group.thread)?.title
      const named = topic ?? version.views[0]?.title ?? 'Shown'
      if (!exchange) return { title: named }
      const asked = whoAsked(exchange)
      const said = exchange.said.replace(/\s+/g, ' ').trim()
      return { time: usedWords(exchange.at, new Date()), title: asked === 'You' ? said || named : `${asked} · ${said || named}` }
    },
    [channel.exchanges, threads.threads]
  )
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
    client.channel.say(text, { language, spoken: true, screen: !inMini }).catch(() => setProblem(refusalCopy('failed')))
  })
  const listening = talk.is === 'listening'
  // A tool at work for the answer: the core works rather than thinks.
  const tool = activity.running.at(-1)?.tool
  const [stageScroll, stageEdges] = useScrollEdges()
  // The places kept for the core: it travels to the one in use and rests there.
  const places = useRef<Record<CorePlace, HTMLElement | null>>({ empty: null, board: null, mini: null })
  const keepers = useRef({
    empty: (element: HTMLElement | null) => {
      places.current.empty = element
    },
    board: (element: HTMLElement | null) => {
      places.current.board = element
    },
    mini: (element: HTMLElement | null) => {
      places.current.mini = element
    }
  })
  const keep = (where: CorePlace) => keepers.current[where]
  const placeIn = useRef<CorePlace>('empty')
  placeIn.current = inMini ? 'mini' : streaming ? 'board' : 'empty'
  const placeOf = useCallback(() => places.current[placeIn.current], [])
  // What is written beside or under the core waits for it to arrive, so it never crosses the core on its way.
  const [arrived, setArrived] = useState(true)
  const [composerBox, composerRoom] = useComposerRoom()

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
  // What is said is as large as the core: large in the middle of an empty stage, smaller in Mini, and on one line
  // beside the small core over the board, where the indicator under the composer offers to set up an AI program.
  const caption = (size: 'large' | 'medium' | 'small', lines: 1 | 2 | undefined) => (
    <Caption
      line={line}
      heard={heard}
      last={last}
      paused={speaking.paused}
      size={size}
      lines={lines}
      problem={failed ?? problem}
      onSetUpEngine={noEngine && size !== 'small' ? onSetUpEngine : undefined}
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
            className="shrink-0"
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
            {caption('medium', 2)}
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
                onClick={mini.onFullWindow}
                className="group mt-1 inline-flex h-6 shrink-0 items-center gap-1 px-1.5 text-text-faint text-xs transition-colors duration-(--duration-quick) hover:text-text-soft"
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
  const readyTopics =
    ready.length > 0 ? (
      <ReadyTopics
        ready={ready}
        exchanges={channel.exchanges}
        onFocus={(thread) => void client.threads.focus(thread).catch(() => undefined)}
        onDismiss={(thread) => void client.threads.dismiss(thread).catch(() => undefined)}
      />
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

  // With views, the core rests small at the top left of the board, its name and state beside it, then what it says
  // on one line, whole when pointed at; the "ready" list under them, and the board under all of it, between the
  // pinned docks when they stand beside it. With none, the core rests large in the middle of the stage.
  const side = docked ? BOARD_SIDE.docked : BOARD_SIDE.free
  const fadeIn = { duration: arrived ? DURATION.calm : DURATION.quick, ease: EASE }
  return (
    <div data-stage="" className="relative flex h-full min-w-0 flex-col">
      {core}
      {streaming && (
        <header className="relative z-10 shrink-0 pt-1.5 pb-2" style={{ paddingInline: side }}>
          <div className="mx-auto flex h-10 w-full min-w-0 items-center gap-3" style={BOARD_COLUMN}>
            <div
              ref={keep('board')}
              aria-hidden="true"
              className="shrink-0"
              style={{ width: BOARD_CORE.square, height: BOARD_CORE.square, margin: -BOARD_CORE.spill }}
            />
            <div className="grid shrink-0 gap-0.5">
              <motion.span layoutId="stage-name" transition={travel} className="font-semibold text-[0.8125rem] leading-4 tracking-[-0.01em]">
                {active.name}
              </motion.span>
              <motion.span layoutId="stage-mood" transition={travel} className="flex leading-4">
                <MoodWord mood={mood} word={word} />
              </motion.span>
            </div>
            {/* What is said comes in once the core, rising from the middle of the stage, has arrived beside it. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: arrived ? 1 : 0 }}
              transition={fadeIn}
              className="flex min-w-0 flex-1 items-center gap-3 border-line border-l pl-3"
              aria-live="polite"
            >
              <OneLine>{(whole) => caption('small', whole ? undefined : 1)}</OneLine>
              {answerLink}
            </motion.div>
          </div>
          {readyTopics && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: arrived ? 1 : 0 }}
              transition={fadeIn}
              className="mx-auto mt-2 w-full"
              style={{ ...BOARD_COLUMN, paddingLeft: BOARD_CORE.square - 2 * BOARD_CORE.spill + 12 }}
            >
              {readyTopics}
            </motion.div>
          )}
        </header>
      )}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {streaming && (
            <motion.div
              key="board"
              className="absolute inset-x-0 top-0"
              style={{ bottom: composerRoom }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: DURATION.calm, ease: EASE } }}
              exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
            >
              <ViewBoard
                className="h-full pt-1 pb-3"
                style={{ paddingInline: side }}
                views={stream}
                arrived={shown.arrived}
                attended={attended}
                actions={actionsFor}
                onClose={close}
                describe={describe}
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
                  {caption('large', 2)}
                </div>
                {answerLink}
              </div>
              {readyTopics ? (
                <div className={cn('mt-2 flex w-full justify-center', COLUMN)}>{readyTopics}</div>
              ) : (
                // Until the person has said anything, a few things to try.
                !noEngine && !running && !speaking.sentence && channel.exchanges.every((line) => line.trigger !== undefined) && <Suggestions onSay={say} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* The composer floats over the bottom of the screen, under the board, with nothing painted behind it. */}
      <div ref={composerBox} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-8 pb-4">
        <div className="pointer-events-auto mx-auto grid w-full gap-1.5" style={BOARD_COLUMN}>
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
 * The persona's name and what it is doing, large under the core in the middle of an empty stage. They glide to and
 * from their places beside the core over the board with it.
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
      className="group inline-flex h-6 shrink-0 items-center gap-1 px-1.5 text-text-faint text-xs transition-colors duration-(--duration-quick) hover:text-text-soft"
    >
      Full answer
      <GoArrow />
    </motion.button>
  )
}
