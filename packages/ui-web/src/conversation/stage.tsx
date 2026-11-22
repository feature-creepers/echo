import type { Client } from '@repo/client'
import { matchesShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Answer, PersonaId, Settings, ShownView, TurnId } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessIndicator } from '../access/access-indicator.tsx'
import { type Dropped, DropState, useWindowDrop } from '../attachments/drop-state.tsx'
import { useAttachments } from '../attachments/use-attachments.ts'
import { playCue } from '../audio/cues.ts'
import { findDevice } from '../audio/devices.ts'
import type { SpeechEngine } from '../audio/engine.ts'
import { useTalk } from '../audio/use-talk.ts'
import { keyPress, useDevice } from '../device/device.tsx'
import { useShownPresence } from '../device/presence.ts'
import { useNow } from '../hub/use-now.ts'
import { DOCK_ROOM } from '../library/pinned-docks.tsx'
import { usePlayer } from '../media/player-provider.tsx'
import { refusalCopy } from '../personas/copy.ts'
import { attendedView, useLingering } from '../presence/attention.ts'
import { Eye } from '../presence/eye.tsx'
import type { Mood } from '../presence/eye-motion.ts'
import { cn } from '../primitives/cn.ts'
import { DURATION, EASE, settle } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { FEED } from '../view/rows.ts'
import { type AnswerWords, type Corrections, TopicFeed } from '../view/topic-feed.tsx'
import { TopicIndex } from '../view/topic-index.tsx'
import { useVersions } from '../view/versions.ts'
import { captionOf, useLastHeard } from './caption.ts'
import { EngineIndicator } from './engine-indicator.tsx'
import { GoArrow } from './go-arrow.tsx'
import { InputLine } from './input-line.tsx'
import { moodOf, moodWord } from './mood.ts'
import { latestLine, topicOf, topicsNow } from './now.ts'
import { HUB_WIDTH, NowHub } from './now-hub.tsx'
import { NowStrip, type NowTab, NowTabs } from './now-tabs.tsx'
import { RunningThreads } from './running-threads.tsx'
import { Caption, OneLine } from './stage-caption.tsx'
import { Suggestions } from './suggestions.tsx'
import { usedWords } from './thread-list.tsx'
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
  /** Open the voice settings, when the device could talk once its models are downloaded. */
  onSetUpVoice?: (() => void) | undefined
  /** Show the full answer a line's thread wrote, whole, in the side sheet. */
  onOpenAnswer(turn: TurnId): void
  /** Show a thread's work in the side sheet, or with none, the list of threads. */
  onOpenThread(thread: string | undefined): void
  /**
   * The window is Mini (docs/SPEC.md, section 13.2): the eye and what it says alone, and the way back to the full
   * window. Left out, the full window.
   */
  mini?: { onFullWindow(): void } | undefined
  /** The pinned widgets stand in their docks on both sides of the screen: the answers take the room between them. */
  docked?: boolean | undefined
}

/** The event an app dispatches on the window to start talking, or to send what was said: its global shortcut. */
export const TALK_EVENT = 'echo:talk'

/** The eye's size, in pixels: alone on an empty screen, over the answers, in the bar it shrinks into, and in Mini. */
const EYE = { alone: 200, home: 150, bar: 26, mini: 136 } as const

/** The column the answers, the bar and the composer share, so their edges line up. */
const COLUMN = { maxWidth: FEED.most } as const

/** The room home keeps on each side, in pixels. */
const HOME_SIDE = 32

/** The width of what is said under the eye, and of what is offered there. */
const SAID = 'max-w-[45rem]'

/** The room kept on each side of the answers: from the window's edges, or from the pinned docks beside them. */
const SIDE = { free: 32, docked: DOCK_ROOM + 16 } as const

/** The height of the bar the eye shrinks into, in pixels. */
const BAR = 44

/** The height of the window's title row, which the page runs under: the system's own where it says, else the app's. */
const TITLE_ROW = { '--title': 'env(titlebar-area-height, var(--frame-title-bar))' } as CSSProperties

/** How far down the person must have scrolled, in pixels, before a topic counts as in front of them. */
const AT_TOP = 8

/** How much of a topic must still show under the bar, in pixels, for it to be the one in front: that, or half of it. */
const FRONT_SHOWS = 96

/** How long a topic whose answer waited must stay in front, in milliseconds, for the answer to count as seen. */
const SEEN_AFTER_MS = 1500

/** How far from the end of the topics read, in pixels, the ones before them are read. */
const READ_AHEAD = 800

/** The arrow keys that walk the topics: left and right through the versions of the one in front, up and down between them. */
const WALK: Readonly<Record<string, readonly ['version' | 'topic', 1 | -1]>> = {
  ArrowLeft: ['version', 1],
  ArrowRight: ['version', -1],
  ArrowUp: ['topic', -1],
  ArrowDown: ['topic', 1]
}

/** Whether a key pressed there walks the topics: nowhere in particular, or in the composer while nothing is typed in it. */
const walksFrom = (target: EventTarget | null) =>
  target === document.body || (target instanceof HTMLTextAreaElement && target.value === '' && target.closest('[data-stage]') !== null)

/**
 * How much room the composer takes at the bottom of the stage, kept current: the answers end above it. Measured on
 * the block that holds the composer and the row under it.
 */
function useComposerRoom(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [room, setRoom] = useState(104)
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
 * waves that never line up the same way twice. It keeps the eye alive while sentences are shown, not played.
 */
function syllables(): number {
  const time = performance.now() / 1000
  const beat = Math.abs(Math.sin(time * 7.3)) * Math.abs(Math.sin(time * 2.1 + 0.6))
  return 0.25 + 0.6 * beat + 0.15 * Math.abs(Math.sin(time * 13.7))
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The main screen (docs/SPEC.md, section 13.2): one page that scrolls. At its top, home: the assistant's eye, its
 * name, what it is doing and what it is saying, and around the eye the Now zone, the topics in progress. Under it the
 * topic the person is on, then the others, the one last active first, each an island that shows its latest answer.
 * Scrolled past home, the eye shrinks into a bar that stays at the top, the topics in progress with it. The line to
 * talk to it stays at the bottom, and names the topic in front of the person, which what they say next is probably
 * about.
 */
export function Stage({
  client,
  personas,
  onSwitch,
  onSetUpEngine,
  onOpenAccess,
  speech,
  voiceLevel,
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
  const shown = useFollowed(client.topics)
  const topics = shown.topics
  const streaming = topics.length > 0
  /** The cards on screen: those of each topic's latest answer. */
  const cards = useMemo(() => topics.flatMap((one) => one.answers[0]?.views ?? []), [topics])
  const earlier = useCallback((topic: string) => client.topics.earlier(topic), [client])
  const versions = useVersions(topics, earlier)
  const threads = useFollowed(client.threads)
  const asleep = useFollowed(client.memory.asleep)

  // The Now zone: the topics in progress, what needs the person first, each numbered by its place.
  const moment = useNow()
  const tabs = useMemo<NowTab[]>(
    () => topicsNow(topics, moment).map((one, at) => ({ topic: one.topic, number: at + 1, line: latestLine(one.answers[0]) })),
    [topics, moment]
  )
  /** The topic in progress the person picked, until the conversation moves on to another thread. */
  const [picked, setPicked] = useState<string>()
  const focused = topicOf(
    threads.threads.find((thread) => thread.id === threads.focus),
    threads.threads
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the conversation moving on is what takes the pick away
  useEffect(() => setPicked((was) => (was === focused ? was : undefined)), [focused])
  /**
   * The topic that leads the page, under the Now zone: the one picked, else the one the conversation is on while it
   * is the last one active, else the first in progress, which is what needs the person most. With nothing in
   * progress there is no Now zone, and the topics simply follow each other.
   */
  const lead = useMemo(() => {
    if (tabs.length === 0) return undefined
    if (tabs.some((tab) => tab.topic.id === picked)) return picked
    return focused !== undefined && topics[0]?.topic.id === focused ? focused : tabs[0]?.topic.id
  }, [tabs, picked, focused, topics])
  const ordered = useMemo(() => {
    const first = topics.find((one) => one.topic.id === lead)
    return first ? [first, ...topics.filter((one) => one !== first)] : topics
  }, [topics, lead])
  const names = useMemo(() => ordered.map((one) => one.topic), [ordered])
  /** The threads at work, behind or on the stage: each goes on while the person asks for something else. */
  const working = threads.threads.filter((thread) => thread.state === 'working').length
  const [problem, setProblem] = useState<string>()

  const active = personas.available.find((persona) => persona.id === personas.active) ?? personas.available[0]
  /** The persona the toggle hands over to: the next one in the list. */
  const next = personas.available[(personas.available.findIndex((persona) => persona.id === active?.id) + 1) % personas.available.length]
  const other = next && next.id !== active?.id ? next : undefined
  const last = channel.exchanges.at(-1)
  const running = channel.running !== undefined
  /** Sentences whose sound is still being made: the voice is about to speak. */
  const voicing = speaking.sentence !== undefined || speaking.waiting > 0
  /** The sentence heard now, else the last one heard: the caption stays on what was said. */
  const heard = useLastHeard(speaking)
  const noEngine = engines !== undefined && engines.active === undefined

  // The page that scrolls, its home, and what the person has in front of them on it.
  const scroller = useRef<HTMLDivElement | null>(null)
  const home = useRef<HTMLElement | null>(null)
  // The room home has for the hub and the column for its tabs, kept current.
  const [room, setRoom] = useState<number>(HUB_WIDTH)
  useEffect(() => {
    const element = home.current
    if (!element) return
    const observer = new ResizeObserver(() => setRoom(element.clientWidth - 2 * HOME_SIDE))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [past, setPast] = useState(false)
  const [front, setFront] = useState<string>()
  /** The topic the person said their words are not about: its chip stays away until another topic is in front. */
  const [notAbout, setNotAbout] = useState<string>()
  const [composerBox, composerRoom] = useComposerRoom()
  // How much of the top of the page the bar covers once it shows: the title row's height and its own.
  const bar = useRef<HTMLDivElement | null>(null)
  const covered = useCallback(() => bar.current?.offsetHeight ?? BAR, [])
  const look = useCallback(() => {
    const area = scroller.current
    if (!area) return
    setPast(home.current !== null && area.scrollTop > home.current.offsetHeight - covered())
    // In front: the first topic that still shows a good part of itself under the bar. At the very top nothing is:
    // what is said there is as likely about something new.
    let key: string | undefined
    if (area.scrollTop > AT_TOP) {
      const under = area.getBoundingClientRect().top + covered()
      for (const island of area.querySelectorAll<HTMLElement>('[data-topic]')) {
        const { bottom, height } = island.getBoundingClientRect()
        if (bottom - under <= Math.min(FRONT_SHOWS, height / 2)) continue
        key = island.dataset.topic
        break
      }
    }
    setFront(key)
  }, [covered])
  // Topics coming and going change what is in front without a scroll.
  useEffect(look, [look, topics])
  // What is said is probably about the topic in front; at the very top, about the one the person picked, if any.
  const facing = front ?? (picked !== undefined && picked === lead ? picked : undefined)
  const about = facing === undefined || facing === notAbout ? undefined : names.find((topic) => topic.id === facing)
  const aboutId = useRef<string | undefined>(undefined)
  aboutId.current = about?.id

  // An answer that waited counts as seen once its topic has stood in front of the person for a moment.
  useEffect(() => {
    const waiting = threads.threads.filter((thread) => thread.state === 'ready' && topicOf(thread, threads.threads) === front)
    if (front === undefined || waiting.length === 0) return
    const timer = window.setTimeout(() => {
      for (const thread of waiting) void client.threads.dismiss(thread.id).catch(() => undefined)
    }, SEEN_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [front, threads.threads, client])

  /** Bring a topic's island under the bar. */
  const goTo = useCallback(
    (topic: string) => {
      const area = scroller.current
      const island = area?.querySelector<HTMLElement>(`[data-topic="${CSS.escape(topic)}"]`)
      if (!area || !island) return
      // The island that leads comes right under the bar, so nothing of the tabs over it shows; any other keeps a gap.
      const leads = island.parentElement?.firstElementChild === island && island.parentElement.previousElementSibling?.tagName === 'NAV'
      const top = area.scrollTop + island.getBoundingClientRect().top - area.getBoundingClientRect().top - covered() - (leads ? 0 : 8)
      area.scrollTo({ top, behavior: still() ? 'auto' : 'smooth' })
    },
    [covered]
  )

  /**
   * Pick a topic in progress: its island leads the page, and what is said next is probably about it. An answer of it
   * that waited is said now. Scrolled past home, its island is brought under the bar.
   */
  const [going, setGoing] = useState<string>()
  const pick = useCallback(
    (topic: string) => {
      setPicked(topic)
      setNotAbout(undefined)
      const waiting = threads.threads.find((thread) => thread.state === 'ready' && topicOf(thread, threads.threads) === topic)
      if (waiting) void client.threads.focus(waiting.id).catch(() => undefined)
      if (past) setGoing(topic)
    },
    [threads.threads, client, past]
  )
  // Once its island leads, it is gone to.
  useEffect(() => {
    if (going === undefined || ordered[0]?.topic.id !== going) return
    goTo(going)
    setGoing(undefined)
  }, [going, ordered, goTo])

  const say = useCallback(
    (text: string, about?: string) => {
      setProblem(undefined)
      client.speech.stop()
      client.channel.say(text, { about }).catch(() => setProblem(refusalCopy('failed')))
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
      client.channel.say(text, { handed, about: aboutId.current }).catch(() => setProblem(refusalCopy('failed')))
      return true
    },
    [client, attachments]
  )
  // The cards can also snooze the reminder they show.
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
  // A topic whose answer starts waiting comes with a soft sound when answers are heard on this device, for a person
  // looking elsewhere. Those already waiting when the window opens make none.
  const waiting = tabs.flatMap((tab) => (tab.topic.progress === 'ready' ? [tab.topic.id] : [])).join(' ')
  const heardWaiting = useRef<string | undefined>(undefined)
  const { aloud } = device.settings.voice
  const { speaker } = device.settings
  useEffect(() => {
    if (!shown.ready) return
    const before = heardWaiting.current
    heardWaiting.current = waiting
    if (before === undefined || !aloud || waiting === '') return
    const known = new Set(before.split(' '))
    if (waiting.split(' ').some((id) => !known.has(id))) void findDevice(speaker, 'audiooutput').then((sink) => playCue('ready', sink))
  }, [waiting, shown.ready, aloud, speaker])
  const dropping = useWindowDrop((dropped: Dropped) => {
    // Mini has no composer for them to wait in.
    if (inMini) return
    attachments.add(dropped.files, dropped.folders)
    if (dropped.unplaced > 0) attachments.refuse('A folder can be given only in the desktop app, which knows where it is.')
  }, device.host?.files?.pathOf)
  /**
   * What a card can do. What it says for the person (an answer picked in its questionnaire) is about its topic. Only
   * a view shown in answer to what the person just asked may start what it plays: one read on opening never does, as
   * the person may have stopped it.
   */
  const answering = channel.running ?? channel.exchanges.at(-1)?.turn
  const actionsFor = useCallback(
    (shownView: ShownView, topic: string): ViewActions => ({
      ...actions,
      say: (text: string) => say(text, topic),
      ...(shownView.turn !== undefined && shownView.turn === answering && shown.arrived.includes(shownView.id) ? { autoplay: shownView.id } : {})
    }),
    [actions, say, shown.arrived, answering]
  )
  // Removing a card takes it out of its answer.
  const remove = useCallback((view: ShownView) => void client.topics.clear(view.id).catch(() => undefined), [client])
  // What an answer says over its cards: when it was asked for and in what words, and what the assistant said. The
  // conversation's own line is the latest there is of an answer still being given.
  const describe = useCallback(
    (answer: Answer): AnswerWords => {
      const exchange = channel.exchanges.find((one) => one.turn === answer.id) ?? answer.exchange
      if (!exchange) return {}
      const who = whoAsked(exchange)
      const asked = exchange.said.replace(/\s+/g, ' ').trim()
      const said = exchange.replied.replace(/\s+/g, ' ').trim()
      return {
        time: usedWords(exchange.at, new Date()),
        asked: who === 'You' ? asked || undefined : asked === '' ? who : `${who} · ${asked}`,
        said: said || undefined,
        working: exchange.outcome === 'running',
        problem: exchange.outcome === 'failed' ? (exchange.problem ?? 'It could not answer.') : undefined,
        onOpenWhole: exchange.written === undefined ? undefined : () => onOpenAnswer(exchange.turn)
      }
    },
    [channel.exchanges, onOpenAnswer]
  )
  // What the person corrects of how things were filed. A refusal is said under the eye, as any other.
  const corrections = useMemo<Corrections>(() => {
    const refused = () => setProblem(refusalCopy('failed'))
    return {
      rename: (topic, title) => void client.topics.rename(topic, title).catch(refused),
      putAway: (topic) => void client.topics.archive(topic, true).catch(refused),
      move: (answer, to) => void client.topics.move(answer, to).catch(refused),
      merge: (topic, into) => void client.topics.merge(topic, into).catch(refused)
    }
  }, [client])
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
    // Said aloud: a yes to what sends, pays or publishes counts only with the person's confirmation phrase. Said to
    // Mini, which shows no views, the assistant says a little more.
    client.channel.say(text, { language, spoken: true, screen: !inMini, about: aboutId.current }).catch(() => setProblem(refusalCopy('failed')))
  })
  const listening = talk.is === 'listening'
  // A tool at work for the answer: the eye works rather than thinks.
  const tool = activity.running.at(-1)?.tool

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
  const word = moodWord(mood, tool, active?.stance ?? 'accommodating')
  const failed =
    talk.is === 'failed' ? talk.reason : !running && !speaking.sentence && last?.outcome === 'failed' ? (last.problem ?? 'It could not answer.') : undefined

  // The eye's pupil moves with the voice it hears, or the voice it speaks; with no sound, with the rhythm of syllables.
  const voices = useRef({ listening, voiceLevel })
  voices.current = { listening, voiceLevel }
  const level = useRef(() => (voices.current.listening ? heardLevel() : (voices.current.voiceLevel?.() ?? syllables())))

  // The card the assistant is talking about, which says so by its name.
  const attendedNow = attendedView(cards, speaking.sentence?.turn, channel.running, shown.arrived)
  const attended = useLingering(attendedNow, (id) => cards.some((view) => view.id === id))

  // A topic that becomes active, answered or asked for again, rises to the top and is brought into sight, unless it
  // already is. One read on opening is simply there.
  const [top] = names
  const rose = useRef<{ at: string | undefined; ready: boolean; room: number }>({ at: undefined, ready: false, room: composerRoom })
  rose.current.room = composerRoom
  useEffect(() => {
    const was = { ...rose.current }
    rose.current.at = top?.at
    rose.current.ready = shown.ready
    const area = scroller.current
    if (!area || !was.ready || top === undefined || (was.at !== undefined && top.at <= was.at)) return
    const island = area.querySelector<HTMLElement>('[data-topic]')
    if (!island) return
    const box = area.getBoundingClientRect()
    const at = island.getBoundingClientRect()
    if (at.top >= box.top + covered() && at.bottom <= box.bottom - was.room) return
    area.scrollTo({ top: area.scrollTop + at.top - box.top - covered() - 8, behavior: still() ? 'auto' : 'smooth' })
  }, [top, shown.ready, covered])

  // The topics active before those read are read as the person nears the end of them.
  const [end, setEnd] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!end || !shown.more) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && void client.topics.older().catch(() => undefined), {
      root: scroller.current,
      rootMargin: `${READ_AHEAD}px`
    })
    observer.observe(end)
    return () => observer.disconnect()
  }, [end, shown.more, client, topics.length])

  // The arrows walk the topics while nothing is being typed: left and right through the versions of the one in
  // front, or of the first one at the very top, up and down from one topic to the next.
  const { step } = versions
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const walk = WALK[event.key]
      if (!walk || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !walksFrom(event.target)) return
      const [what, way] = walk
      const at = names.findIndex((topic) => topic.id === front)
      if (what === 'version') {
        const walked = names[Math.max(at, 0)]
        if (!walked) return
        void step(walked.id, way)
      } else {
        const next = names[at + way]
        if (next) goTo(next.id)
        else if (way < 0) scroller.current?.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' })
        else return
      }
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [names, front, step, goTo])

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

  // The cards on screen when the window became Mini: one that arrived since waits unseen for the full window.
  const seenInFull = useRef<readonly string[]>([])
  if (!inMini) seenInFull.current = cards.map((view) => view.id)
  const unseen = inMini && cards.some((view) => !seenInFull.current.includes(view.id))

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
  const eye = (size: number) => <Eye mood={mood} size={size} level={level.current} />

  // Mini: the eye alone in the middle, its name, state and what it says under it, and nothing else of the stage.
  // Pressing it talks, as the talk key does; every button here is pressed, and the ground round them drags the window.
  if (mini) {
    const press = canTalk ? toggle : onSetUpVoice
    return (
      <div data-stage="" className="relative flex h-full min-w-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe px-4 pb-4 text-center [&_button]:no-drag">
          <button type="button" aria-label={listening ? 'Send' : 'Talk'} disabled={press === undefined} onClick={press} className="shrink-0">
            {eye(EYE.mini)}
          </button>
          <span className="display mt-2 text-[2rem] leading-7">{active.name}</span>
          <MoodWord mood={mood} word={word} className="mt-1.5" />
          <div className="mt-2 grid min-h-[3.25rem] w-full justify-items-center" aria-live="polite">
            {caption('medium', 2)}
          </div>
          {/* A view that arrived here waits in its topic: the way to it, in the full window. */}
          <AnimatePresence initial={false}>
            {unseen && (
              <QuietLink key="unseen" onPress={mini.onFullWindow} className="mt-1">
                Shown in the full window
              </QuietLink>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // What rests under the eye is what the assistant says while it says it, what was asked while it works, or a
  // problem. Once said, the reply is the headline of its answer below, and is not written twice.
  const answered = last !== undefined && topics.some((one) => one.answers[0]?.id === last.turn)
  const resting = line === 'heard' || line === 'replied'
  const captioned = line !== 'nothing' && !(resting && answered)
  // The last reply's full answer, when its thread wrote one and no answer below offers it.
  const written = last?.written !== undefined && !failed && !problem && !answered ? last.turn : undefined
  // The hub needs its width; in a narrower window the Now zone is the eye and the tabs alone.
  const hub = tabs.length > 0 && room >= HUB_WIDTH
  // While something is being said or has gone wrong, the bar says it; else it holds the topics in progress.
  const telling = speaking.sentence !== undefined || running || failed !== undefined || problem !== undefined
  const switchPersona = () => {
    if (other) onSwitch(other.id).catch(() => setProblem(refusalCopy('failed')))
  }
  const side = docked ? SIDE.docked : SIDE.free

  return (
    // The page starts at the window's top, under the title row, so home's dots run under it too.
    <div data-stage="" className="-mt-(--title) relative flex h-[calc(100%+var(--title))] min-w-0 flex-col" style={TITLE_ROW}>
      {/* The bar the eye shrinks into once home has scrolled away, the title row's ground with it. Pressing its eye goes back up. */}
      <motion.div
        ref={bar}
        initial={false}
        animate={{ opacity: past ? 1 : 0, y: past ? 0 : -6 }}
        transition={settle}
        inert={!past}
        className="absolute inset-x-0 top-0 z-20 border-line border-b bg-ground pt-(--title)"
        style={{ paddingInline: side }}
      >
        <div className="mx-auto flex w-full min-w-0 items-center gap-3" style={{ ...COLUMN, height: BAR }}>
          <button
            type="button"
            aria-label="Back to the top"
            title="Back to the top"
            onClick={() => scroller.current?.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' })}
            className="flex shrink-0 items-center gap-2.5"
          >
            {eye(EYE.bar)}
            <span className="display text-[1.375rem] leading-none">{active.name}</span>
          </button>
          <MoodWord mood={mood} word={word} />
          <div className="flex min-w-0 flex-1 items-stretch self-stretch border-line border-l" aria-live="polite">
            {tabs.length > 0 && !telling ? (
              <NowTabs tabs={tabs} selected={lead} picked={picked} onPick={pick} />
            ) : (
              <div className="flex min-w-0 flex-1 items-center pl-3">
                {captioned && <OneLine>{(whole) => caption('small', whole ? undefined : 1)}</OneLine>}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <motion.div layoutScroll ref={scroller} onScroll={look} className="scroll-none min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section
          ref={home}
          className={cn('relative flex flex-col items-center px-8', streaming ? 'pt-[calc(var(--title)+1rem)] pb-9' : 'min-h-full justify-center pt-(--title)')}
          style={streaming ? undefined : { paddingBottom: composerRoom + 24 }}
        >
          {/* Fine dots under home, fading out where the answers start. */}
          <span aria-hidden="true" className="dot-ground pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]" />
          {hub ? (
            <div className="relative">
              <NowHub tabs={tabs} selected={lead} picked={picked} onPick={pick} eye={eye}>
                <h1 className="display text-lg leading-4">{active.name}</h1>
                <MoodWord mood={mood} word={word} />
              </NowHub>
            </div>
          ) : (
            <>
              <span className="relative grid place-items-center">
                {/* The eye stands on a disc of the ground, so no dot runs under its lines. */}
                <span aria-hidden="true" className="-inset-3.5 absolute bg-ground [border-radius:50%]" />
                <span className="relative">{eye(streaming ? EYE.home : EYE.alone)}</span>
              </span>
              <h1 className="display relative mt-3 text-[2.75rem] leading-[2.5rem]">{active.name}</h1>
              <MoodWord mood={mood} word={word} className="relative mt-1.5" />
            </>
          )}
          {(captioned || written !== undefined) && (
            <div className={cn('relative mt-5 flex w-full flex-col items-center gap-1.5 text-center', SAID)}>
              <div className="flex w-full justify-center" aria-live="polite">
                {captioned && caption(streaming ? 'medium' : 'large', streaming ? 2 : undefined)}
              </div>
              <AnimatePresence initial={false}>
                {written !== undefined && (
                  <QuietLink key={written} onPress={() => onOpenAnswer(written)}>
                    Full answer
                  </QuietLink>
                )}
              </AnimatePresence>
            </div>
          )}
          {/* Until the person has said anything, a few things to try. */}
          {!streaming && !noEngine && !running && !speaking.sentence && channel.exchanges.every((exchange) => exchange.trigger !== undefined) && (
            <div className="relative mt-4">
              <Suggestions onSay={say} />
            </div>
          )}
        </section>
        {streaming && (
          <div style={{ paddingInline: side, paddingBottom: composerRoom + 24 }}>
            <div className="mx-auto w-full" style={COLUMN}>
              {tabs.length > 0 && <NowStrip tabs={tabs} selected={lead} picked={picked} onPick={pick} narrow={room < FEED.stacked} />}
              <TopicFeed
                topics={ordered}
                lead={lead}
                moment={moment}
                stepped={versions.stepped}
                onStep={(topic, way) => void step(topic, way)}
                arrived={shown.arrived}
                attended={attended}
                actions={actionsFor}
                onRemove={remove}
                describe={describe}
                corrections={corrections}
              />
              {/* Where the topics read so far end: the ones before them are read as it comes near. */}
              {shown.more && (
                <p ref={setEnd} className="caps flex items-center gap-[7px] border-line-strong border-t pt-3.5 pb-9 text-text-soft">
                  <span aria-hidden="true" className="size-[7px] border border-text-soft" />
                  Earlier topics
                </p>
              )}
            </div>
          </div>
        )}
      </motion.div>
      {streaming && names.length > 1 && (
        <TopicIndex
          now={tabs.map((tab) => tab.topic)}
          topics={names.filter((topic) => tabs.every((tab) => tab.topic.id !== topic.id))}
          front={front ?? lead}
          onGo={(topic) => (tabs.some((tab) => tab.topic.id === topic) ? pick(topic) : goTo(topic))}
        />
      )}

      {/* The composer stays at the bottom, on the ground: the answers end above it. */}
      <div ref={composerBox} className="pointer-events-none absolute inset-x-0 bottom-0 z-20" style={{ paddingInline: side - 8 }}>
        <div className="pointer-events-auto mx-auto grid w-full min-w-0 grid-cols-1 gap-1.5 bg-ground px-2 pt-2 pb-3" style={{ maxWidth: FEED.most + 16 }}>
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
            persona={{ name: active.name, stance: active.stance, mood, next: other && { name: other.name }, onToggle: switchPersona }}
            about={about === undefined ? undefined : { title: about.title, onRemove: () => setNotAbout(about.id) }}
          />
          {/* Why a file was not added, quietly on the left; what it may reach and what it thinks with on the right, changed
              on the spot from their menus. */}
          <div className="flex items-start justify-between gap-4">
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
                  className="min-w-0 pt-0.5 pl-1 text-text-soft text-xs leading-snug"
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

/** What the eye is doing, in a word, after a small square: in the accent while something is happening, in the ink at rest. */
function MoodWord({ mood, word, className }: { mood: Mood; word: string; className?: string }) {
  const busy = mood !== 'idle' && mood !== 'asleep'
  return (
    <span className={cn('caps flex shrink-0 items-center gap-[7px] text-text-soft', className)}>
      <span aria-hidden="true" className={cn('size-[7px] transition-colors duration-(--duration-calm) ease-soft', busy ? 'bg-accent' : 'bg-text')} />
      {word}
    </span>
  )
}

/** A quiet way to something else: the full answer of the last reply, or the full window from Mini. */
function QuietLink({ onPress, className, children }: { onPress(): void; className?: string; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
      transition={settle}
      onClick={onPress}
      className={cn(
        'caps group inline-flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text',
        className
      )}
    >
      {children}
      <GoArrow />
    </motion.button>
  )
}
