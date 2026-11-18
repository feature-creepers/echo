import type { Client } from '@repo/client'
import { matchesShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Look, PersonaId, Settings, ShownView, TurnId } from '@repo/protocol'
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
import { useFileActions } from '../files/file-actions.ts'
import { usePlayer } from '../media/player-provider.tsx'
import { refusalCopy } from '../personas/copy.ts'
import { attendedView, useLingering } from '../presence/attention.ts'
import { fieldOf } from '../presence/field.ts'
import { gazeAt, middleOf, type Point } from '../presence/gaze.ts'
import { MOODS as ALL_MOODS, type Around, BANDS, type Pose } from '../presence/life.ts'
import { useCoreLight } from '../presence/light.ts'
import { Orb } from '../presence/orb.tsx'
import type { Mood } from '../presence/painter.ts'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { ArrowGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, settle } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { createPush, scrollsUnder, wheelTravel } from '../view/push.ts'
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
  /** The assistant's voice's spectrum right now, read into the bands given, when the device speaks it. */
  voiceBands?: ((into: Float32Array) => Float32Array | undefined) | undefined
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

const MOODS: Record<Mood, string> = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', working: 'Working', speaking: 'Speaking', asleep: 'Asleep' }

/** How strongly the light around the core shows in each mood: brighter while it hears or speaks, dim asleep. */
const HALO: Record<Mood, number> = { idle: 0.7, listening: 1, thinking: 0.85, working: 0.9, speaking: 1, asleep: 0.3 }

/**
 * How much of its light each look casts on the ground round it. The lens keeps its light inside its glass, as the
 * eye it is after does: a red cast on everything round it would read as a warning light.
 */
const CASTS: Record<Look, number> = { hud: 1, lens: 0.35 }

/** How far the core looks: at this many pixels away, its eye is turned about seven tenths of the way. */
const GAZE_REACH = 460

/** What the core looks at on the screen: a point, and the box of the view there when it is a view. */
export interface Sight {
  point: Point
  box?: DOMRect | undefined
}

/**
 * The largest the core is drawn, in CSS pixels. Its canvas is always this size, and draws the core at the size it is
 * at, so it stays sharp at every size on its way from one place to another.
 */
const LARGEST = 280

/**
 * How the core travels between its places, and how its name and state go with it: a spring soft enough to follow
 * with the eye, damped so it settles without bouncing, in about half a second.
 */
const TRAVEL = { stiffness: 210, damping: 30 } as const

/**
 * How firmly the person must scroll on down at home to go on to the stream: this many pixels of wheel within this
 * many milliseconds.
 */
const LEAVE = { far: 40, within: 450 } as const
const travel = { type: 'spring', stiffness: TRAVEL.stiffness, damping: TRAVEL.damping, mass: 1 } as const

interface CoreProps {
  mood: Mood
  level: () => number
  bands: () => ArrayLike<number> | undefined
  load: () => number | undefined
  /** Where the core looks now, read on every frame; nothing when it has nothing to look at. */
  sight: () => Sight | undefined
  /** The place kept for the core on the screen now, read on every frame: it travels there, and rests there. */
  place: () => HTMLElement | null
  /** Told when the core arrives at its place, and when it leaves it: what is written under it waits for it. */
  onArrive(arrived: boolean): void
}

/**
 * The core, one for the whole stage, never drawn twice: it travels between the places the stage keeps for it (the
 * middle of an empty stage, home, the top of the column) on a spring, and is drawn again at each size on its way, so
 * nothing is stretched or swapped. With it goes the soft light it casts on the ground: the accent, faint, fading to
 * nothing well before any edge, leaning a little towards where the core looks, brighter as the computer works
 * harder. All of it is written on every frame the core draws, as a transform and an opacity only, so it costs no
 * layout and React draws nothing for it. The same frame tells the ground where the core is, how much light it casts
 * and where it looks, so the dots round it and round what it looks at light up with it.
 */
function Core({ mood, level, bands, load, sight, place, onArrive }: CoreProps) {
  const box = useRef<HTMLDivElement>(null)
  const halo = useRef<HTMLSpanElement>(null)
  const light = useCoreLight()
  const seen = useRef<Sight | undefined>(undefined)
  // Where the core is, from the top left of the stage, and how large, with how fast each is changing; the place it
  // rests on, once it has arrived there; and where the stage itself is on the screen, as last read.
  const at = useRef({
    x: 0,
    y: 0,
    size: LARGEST,
    speedX: 0,
    speedY: 0,
    growth: 0,
    time: 0,
    placed: false,
    arrived: true,
    rested: null as HTMLElement | null,
    left: 0,
    top: 0
  })
  const arrive = useRef(onArrive)
  arrive.current = onArrive
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), [])
  // From what the last frame read, so that looking costs no reading of the layout.
  const middle = useCallback((): Point | undefined => {
    const here = at.current
    return here.placed ? { x: here.left + here.x, y: here.top + here.y } : undefined
  }, [])
  /**
   * Puts the core where it belongs now. On the place it rests on, it is simply there: when that place scrolls,
   * resizes or is pushed by what is laid out round it, the core moves with it and has nothing to chase. On its way
   * to another place, it goes one step further on its spring, when a frame is being drawn.
   */
  const settleCore = useCallback(
    (drawing: boolean) => {
      const element = box.current
      const slot = place()
      const stage = element?.offsetParent?.getBoundingClientRect()
      const here = at.current
      if (!element || !slot || !stage) return
      const kept = slot.getBoundingClientRect()
      const target = { x: kept.left - stage.left + kept.width / 2, y: kept.top - stage.top + kept.height / 2, size: kept.width }
      const now = performance.now()
      if (!here.placed || here.rested === slot || still.matches) {
        Object.assign(here, target, { speedX: 0, speedY: 0, growth: 0, placed: true, rested: slot })
      } else if (drawing) {
        // Small steps, so a long frame never throws it.
        for (let left = Math.min(0.05, (now - here.time) / 1000); left > 1e-6; left -= 1 / 240) {
          const step = Math.min(left, 1 / 240)
          here.speedX += (TRAVEL.stiffness * (target.x - here.x) - TRAVEL.damping * here.speedX) * step
          here.speedY += (TRAVEL.stiffness * (target.y - here.y) - TRAVEL.damping * here.speedY) * step
          here.growth += (TRAVEL.stiffness * (target.size - here.size) - TRAVEL.damping * here.growth) * step
          here.x += here.speedX * step
          here.y += here.speedY * step
          here.size += here.growth * step
        }
        // It rests on its new place once it is within half a pixel of it and all but still.
        const away = Math.hypot(target.x - here.x, target.y - here.y) + Math.abs(target.size - here.size)
        if (away < 0.5 && Math.hypot(here.speedX, here.speedY) < 4) here.rested = slot
      } else {
        return
      }
      here.time = now
      here.left = stage.left
      here.top = stage.top
      // Arrived once it is within a few pixels of its place and nearly still.
      const arrived =
        here.rested === slot ||
        (Math.hypot(target.x - here.x, target.y - here.y) + Math.abs(target.size - here.size) < 6 && Math.hypot(here.speedX, here.speedY) < 60)
      if (arrived !== here.arrived) {
        here.arrived = arrived
        arrive.current(arrived)
      }
      // On whole device pixels, so its finest lines stay one pixel sharp.
      const ratio = window.devicePixelRatio || 1
      const left = Math.round((here.x - LARGEST / 2) * ratio) / ratio
      const top = Math.round((here.y - LARGEST / 2) * ratio) / ratio
      element.style.transform = `translate3d(${left}px,${top}px,0)`
    },
    [place, still]
  )
  // No frame is drawn while the core is out of sight. What scrolls or resizes still moves its place then, so the
  // core is kept on it there too, and is drawn again as soon as its place is back in sight.
  useEffect(() => {
    const keep = () => settleCore(false)
    window.addEventListener('scroll', keep, { capture: true, passive: true })
    window.addEventListener('resize', keep)
    return () => {
      window.removeEventListener('scroll', keep, { capture: true })
      window.removeEventListener('resize', keep)
    }
  }, [settleCore])
  const gaze = useCallback((): readonly [number, number] | undefined => {
    const now = sight()
    seen.current = now
    const from = middle()
    if (!now || !from) return undefined
    return gazeAt(from, now.point, GAZE_REACH)
  }, [sight, middle])
  const scale = useCallback(() => at.current.size / LARGEST, [])
  // What is round it, for its glass to reflect: the pointer while it moves, and the view it looks at, each told
  // from the core's middle in its own radii, up as up.
  const around = useCallback((): Around | undefined => {
    const now = seen.current
    const from = middle()
    if (!now || !from) return undefined
    const radius = at.current.size / 2
    const told = (point: Point): [number, number] => [(point.x - from.x) / radius, (from.y - point.y) / radius]
    if (!now.box) return { pointer: told(now.point) }
    return { view: [...told(middleOf(now.box)), now.box.width / 2 / radius, now.box.height / 2 / radius] }
  }, [middle])
  const onFrame = useCallback(
    (pose: Pose) => {
      settleCore(true)
      const here = at.current
      const cast = (Object.keys(CASTS) as Look[]).reduce((sum, look) => sum + CASTS[look] * pose.looks[look], 0)
      const glow = ALL_MOODS.reduce((sum, each) => sum + HALO[each] * pose.weights[each], 0) * (0.75 + 0.6 * pose.power)
      const shown = here.size / LARGEST
      if (halo.current) {
        halo.current.style.opacity = (glow * cast).toFixed(3)
        halo.current.style.transform = `translate3d(${(pose.gaze[0] * here.size * 0.12).toFixed(1)}px,${(-pose.gaze[1] * here.size * 0.12).toFixed(1)}px,0) scale(${shown.toFixed(4)})`
      }
      const from = middle()
      if (!light || !from) return
      light.core = { x: from.x, y: from.y, radius: here.size / 2 }
      light.glow = glow * (0.4 + 0.6 * cast)
      light.power = pose.power
      // What it does goes on through the ground round it: its voice, its sweep, its beat, its waking.
      fieldOf(pose, light.field)
      light.voice = pose.echo
      light.voiceShift = pose.echoShift
      const target = seen.current?.box
      light.spot =
        target && pose.attention > 0.01
          ? {
              x: target.left + target.width / 2,
              y: target.top + target.height / 2,
              radius: Math.max(target.width, target.height) * 0.62,
              strength: pose.attention
            }
          : undefined
    },
    [light, settleCore, middle]
  )
  // When the core leaves the screen, it lights nothing round it any more.
  useEffect(
    () => () => {
      if (light) {
        light.core = undefined
        light.spot = undefined
      }
    },
    [light]
  )
  return (
    <div
      ref={box}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[5] will-change-transform"
      style={{ width: LARGEST, height: LARGEST }}
    >
      <span
        ref={halo}
        className="pointer-events-none absolute -inset-[42%] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_15%,transparent),color-mix(in_oklab,var(--accent)_6%,transparent)_45%,transparent)] will-change-[transform,opacity]"
      />
      <Orb
        size={LARGEST}
        scale={scale}
        mood={mood}
        level={level}
        bands={bands}
        gaze={gaze}
        load={load}
        around={around}
        onFrame={onFrame}
        className="relative"
      />
    </div>
  )
}

/** How long after the pointer last moved the core still follows it, in milliseconds; then it rests its gaze. */
const POINTER_HOLD = 4500

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

/** How far the stream sinks while the core rests large at home: the newest view waits under the core's caption. */
const homeShiftOf = (height: number) => Math.round(height * 0.46)

function useHomeShift(): number {
  const [shift, setShift] = useState(() => homeShiftOf(window.innerHeight))
  useEffect(() => {
    const onResize = () => setShift(homeShiftOf(window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return shift
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
export function Stage({ client, personas, onSwitch, onSetUpEngine, speech, voiceLevel, voiceBands, onSetUpVoice, onOpenAnswer }: StageProps) {
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
    bands: heardBands,
    available: canTalk
  } = useTalk(speech, (text, language) => {
    setProblem(undefined)
    client.speech.stop()
    // Said aloud: a yes to what sends, pays or publishes counts only with the person's confirmation phrase.
    client.channel.say(text, language, undefined, true).catch(() => setProblem(refusalCopy('failed')))
  })
  const listening = talk.is === 'listening'
  // A tool at work for the answer: the core works rather than thinks. Routing a turn is part of thinking.
  const tool = activity.running.at(-1)?.tool
  const atWork = running && doing(tool) !== undefined
  const [stageScroll, stageEdges] = useScrollEdges()
  const coreSize = useTopCoreSize()
  // With views, the stream has a notch above its newest view: home, where the core rests large in the middle as on
  // an empty stage and the newest view waits under it. The app opens there; scrolling on up past the newest view
  // goes back there; scrolling down, pressing the view that waits, or a new view arriving goes on to the stream.
  const [home, setHome] = useState(true)
  const homeShift = useHomeShift()
  const newest = stream[0]?.id
  const newestArrived = newest !== undefined && shown.arrived.includes(newest)
  useEffect(() => {
    if (newestArrived) setHome(false)
  }, [newest, newestArrived])
  const atHome = streaming && home
  // The places kept for the core: it travels to the one in use and rests there.
  const places = useRef<Record<'empty' | 'home' | 'top', HTMLElement | null>>({ empty: null, home: null, top: null })
  const keepers = useRef({
    empty: (element: HTMLElement | null) => {
      places.current.empty = element
    },
    home: (element: HTMLElement | null) => {
      places.current.home = element
    },
    top: (element: HTMLElement | null) => {
      places.current.top = element
    }
  })
  const keep = (where: 'empty' | 'home' | 'top') => keepers.current[where]
  const placeIn = useRef<'empty' | 'home' | 'top'>('empty')
  placeIn.current = !streaming ? 'empty' : atHome ? 'home' : 'top'
  const placeOf = useCallback(() => places.current[placeIn.current], [])
  // What is written under the core waits for it to arrive, so it never crosses the core on its way.
  const [arrived, setArrived] = useState(true)
  // Whether the press under way is the one that went on from home to the stream.
  const wentOn = useRef(false)
  // At home, a push of the wheel on down, or a key that would go down, goes on to the stream. The window listens, as
  // nothing on the stage holds the keyboard; but only what happens on the stage counts, and only what nothing there
  // takes for itself: a wheel over the side sheet scrolls the sheet, and an arrow in a menu moves through the menu.
  useEffect(() => {
    if (!atHome) return
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
  }, [atHome])
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
              ? atWork
                ? 'working'
                : 'thinking'
              : 'idle'
  useShownPresence(active?.accent, mood)
  // While it works, the word under the core says what it is doing: searching the web, preparing the view.
  const moodWord = (mood === 'working' ? doing(tool) : undefined) ?? MOODS[mood]
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

  // What the core looks at: the view it is talking about, else the pointer while it moves, else nothing, and it
  // rests its gaze by itself.
  const spoken = speaking.sentence?.turn
  const attendedNow = attendedView(stream, spoken, channel.running, shown.arrived)
  const attended = useLingering(attendedNow, (id) => stream.some((view) => view.id === id))
  const pointer = useRef({ x: 0, y: 0, at: Number.NEGATIVE_INFINITY })
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY, at: performance.now() }
    }
    const onLeave = () => {
      pointer.current.at = Number.NEGATIVE_INFINITY
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [])
  const looking = useRef(attended)
  looking.current = attended
  const sight = useCallback((): Sight | undefined => {
    const view = looking.current
    const card = view === undefined ? null : document.querySelector(`[data-view="${CSS.escape(view)}"]`)
    if (card) {
      const box = card.getBoundingClientRect()
      if (box.bottom > 0 && box.top < window.innerHeight) return { point: middleOf(box), box }
    }
    if (performance.now() - pointer.current.at < POINTER_HOLD) return { point: pointer.current }
    return undefined
  }, [])

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

  // Over the stream, what is said is smaller; at home and on an empty stage, as large as the core is.
  const compact = streaming && !home
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
          className={cn('text-balance', compact ? 'text-[0.9375rem] leading-relaxed' : 'text-xl leading-snug tracking-[-0.01em]')}
        >
          <SpokenLine text={speaking.sentence.text} since={speaking.since} seconds={speaking.seconds} paused={speaking.paused} />
        </motion.p>
      ) : (running || voicing) && (last?.trigger === 'greeting' || last?.trigger === 'reminder') ? null : (running || voicing) && last ? (
        <motion.p
          key={`said:${last.turn}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          className={cn('text-balance text-text-faint', compact ? 'line-clamp-2 text-[0.9375rem] leading-relaxed' : 'text-lg leading-snug')}
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
          className={cn('text-balance text-text-soft', compact ? 'line-clamp-2 text-[0.9375rem] leading-relaxed' : 'line-clamp-3 text-lg leading-snug')}
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
    <div data-stage="" className="relative flex h-full min-w-0 flex-col">
      <Core mood={mood} level={level.current} bands={bands.current} load={load} sight={sight} place={placeOf} onArrive={setArrived} />
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
              <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-(--duration-calm)">
                {moodWord}
              </Eyebrow>
            </motion.span>
            {/* Two lines are kept for what is said, so a longer sentence never moves the stream under it. They come in
                once the core, rising from the middle of the screen, has passed where they are. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: atHome || !arrived ? 0 : 1 }}
              transition={{ duration: arrived ? DURATION.calm : DURATION.quick, ease: EASE }}
              className="mt-3 grid w-full justify-items-center gap-1"
            >
              <div className="relative w-full max-w-[38rem]">
                <div className="h-[3.25rem] text-text" aria-live={atHome ? undefined : 'polite'}>
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
          style={{ bottom: composerRoom.end + homeShift * 0.32 }}
        >
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
            <div ref={keep('home')} aria-hidden="true" className="-my-7" style={{ width: LARGEST, height: LARGEST }} />
            <div className="grid justify-items-center gap-2">
              <motion.h1 layoutId="stage-name" transition={travel} className="font-semibold text-[1.875rem] leading-none tracking-[-0.025em]">
                {active.name}
              </motion.h1>
              <motion.span layoutId="stage-mood" transition={travel}>
                <Eyebrow accent={mood !== 'idle'} className="transition-colors duration-(--duration-calm)">
                  {moodWord}
                </Eyebrow>
              </motion.span>
            </div>
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
              // At home, the stream sinks and dims under the core; pressing the view that waits goes on to it.
              initial={false}
              animate={{ y: atHome ? homeShift : 0, opacity: atHome ? 0.55 : 1 }}
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
                onPastTop={() => setHome(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {!streaming && (
          <div ref={stageScroll} className={cn('scroll-none h-full overflow-y-auto px-8', fade(stageEdges))}>
            <div className="flex min-h-full w-full flex-col items-center justify-center pt-6 pb-32">
              <div ref={keep('empty')} aria-hidden="true" className="-my-7" style={{ width: LARGEST, height: LARGEST }} />
              <div className="grid justify-items-center gap-2">
                <motion.h1 layoutId="stage-name" transition={travel} className="font-semibold text-[1.875rem] leading-none tracking-[-0.025em]">
                  {active.name}
                </motion.h1>
                <motion.span layoutId="stage-mood" transition={travel}>
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
