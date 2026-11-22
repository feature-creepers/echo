import type { Client } from '@repo/client'
import { describeShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Persona } from '@repo/protocol'
import { motion } from 'motion/react'
import { type ReactNode, useId, useMemo } from 'react'
import { FullAnswer } from '../conversation/full-answer.tsx'
import { PROGRESS_WORDS } from '../conversation/now.ts'
import { ProgressMark } from '../conversation/now-tabs.tsx'
import { ProjectForm } from '../conversation/project-form.tsx'
import { Empty, StateDot, ThreadList, usedWords } from '../conversation/thread-list.tsx'
import { ThreadView } from '../conversation/thread-view.tsx'
import { TopicStory } from '../conversation/topic-story.tsx'
import { TopicWork, threadsFor } from '../conversation/topic-work.tsx'
import { TopicsAway } from '../conversation/topics-away.tsx'
import { Transcript } from '../conversation/transcript.tsx'
import { useDevice } from '../device/device.tsx'
import { useNow } from '../hub/use-now.ts'
import { Inspector } from '../inspector/inspector.tsx'
import type { TopicTrace } from '../inspector/sift.ts'
import { Choice } from '../primitives/choice.tsx'
import { cn } from '../primitives/cn.ts'
import { InspectorGlyph, ThreadsGlyph, TranscriptGlyph } from '../primitives/icons.tsx'
import { settle, slide } from '../styles/motion.ts'
import { shownOf, type Versions } from '../view/versions.ts'
import { SheetHandle } from './sheet-handle.tsx'
import { SHEET_TABS, type SheetMove, type SheetPlace, type SheetScope, type SheetTab } from './sheet-place.ts'
import { sheetCssWidth, sheetWidthStyle } from './sheet-width.ts'

const TITLES: Record<SheetTab, string> = { story: 'Story', work: 'Work', trace: 'Trace' }
const GLYPHS: Record<SheetTab, (props: { size?: number }) => ReactNode> = { story: TranscriptGlyph, work: ThreadsGlyph, trace: InspectorGlyph }
const SCOPES: readonly { value: SheetScope; label: string }[] = [
  { value: 'topic', label: 'This topic' },
  { value: 'everything', label: 'Everything' }
]
const many = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** The room one of the window's corner buttons takes, in rem. */
const CORNER_BUTTON = 2.5

interface SideSheetProps {
  client: Client
  personas: readonly Persona[]
  /** Where the sheet stands: the tab it shows, and where each tab is. */
  place: SheetPlace
  /** The tab it shows. */
  tab: SheetTab
  onMove(move: SheetMove): void
  /** The topic in front of the person on the main screen: what the panel is the back of. */
  facing: string | undefined
  /** The version each topic's island shows: the story marks it, and shows another there. */
  versions: Versions
  /** How many of the window's own buttons stand over the panel's top right corner: its tabs keep clear of them. */
  corner: number
  /** Open Library and settings on its Memory page. */
  onOpenMemory?: (() => void) | undefined
  /** How wide the person made the sheet, and what to do as its edge is dragged. */
  resize: {
    width: number
    /** The room the screen under the sheet keeps for itself beside it. */
    keep: number
    onPreview(width: number): void
    onCommit(width: number): void
  }
}

/**
 * The right side of the window: the back of the topic in front of the person, or of everything (docs/SPEC.md, section
 * 13.2). Its story is what was asked and answered, version by version; its work, the threads behind it with all they
 * did; its trace, the raw events. It takes its width from the window, and the screen beside it narrows, so nothing is
 * ever under it, whatever screen is showing. Its left edge resizes it.
 *
 * Its header is the tabs alone. Under them it says what it is the back of, and lets the person choose between the
 * topic in front, which it follows as they scroll or pick one, and everything.
 */
export function SideSheet({ client, personas, place, tab, onMove, facing, versions, corner, onOpenMemory, resize }: SideSheetProps) {
  const channel = useFollowed(client.channel)
  const threads = useFollowed(client.threads)
  const topics = useFollowed(client.topics)
  const device = useDevice()
  const now = useNow()
  const ids = useId()
  const storyKey = device.settings.shortcuts.transcript
  const working = threads.threads.filter((thread) => thread.state === 'working').length
  const answered = place.answer === undefined ? undefined : channel.exchanges.find((exchange) => exchange.turn === place.answer)
  // A thread no longer kept shows the work instead.
  const opened = place.thread !== undefined && threads.threads.some((thread) => thread.id === place.thread) ? place.thread : undefined
  const openThread = (thread: string | undefined) => onMove({ to: 'thread', thread })

  /** The topic the panel is the back of: the one in front, unless it is the back of everything. */
  const topic = place.scope === 'topic' ? topics.topics.find((one) => one.topic.id === facing) : undefined
  const behind = useMemo(() => (topic ? threadsFor(topic.topic.id, threads.threads) : []), [topic, threads.threads])
  // The events about the topic: those that name it, its threads or its turns.
  const trace = useMemo<TopicTrace | undefined>(() => {
    if (!topic) return undefined
    const own = new Set(behind.map((thread) => thread.id))
    const turns = channel.exchanges.flatMap((line) => (line.thread !== undefined && own.has(line.thread) ? [line.turn] : []))
    return { topic: topic.topic.id, threads: own, turns: new Set([...topic.answers.map((answer) => answer.id), ...turns]) }
  }, [topic, behind, channel.exchanges])

  // Each place comes in with a short rise and fade, as a page of the hub does; the one it replaces goes at once.
  const pane = (key: string, content: ReactNode) => (
    <motion.div
      key={key}
      id={`${ids}-panel`}
      role="tabpanel"
      aria-labelledby={`${ids}-${tab}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={settle}
      className="flex min-h-0 flex-1 flex-col"
    >
      {content}
    </motion.div>
  )

  /** The place the tab shows, of the topic in front or of everything. */
  const shown = (): ReactNode => {
    if (place.scope === 'topic' && !topic && place.answer === undefined && opened === undefined)
      return pane('none', <Empty title="No topic in front" text="This follows the topic in front of you on the main screen. Everything shows them all." />)
    if (tab === 'trace') return pane(`trace-${topic?.topic.id ?? ''}`, <Inspector client={client} about={trace} onOpenMemory={onOpenMemory} />)
    if (tab === 'story') {
      if (place.answer !== undefined)
        return pane(
          `answer-${place.answer}`,
          <FullAnswer
            exchange={answered}
            title={threads.threads.find((thread) => thread.id === answered?.thread)?.title}
            persona={personas.find((persona) => persona.id === answered?.persona)}
            onBack={() => onMove({ to: 'answer', turn: undefined })}
          />
        )
      if (topic)
        return pane(
          `story-${topic.topic.id}`,
          <TopicStory
            topic={topic}
            shown={topic.answers[shownOf(topic, versions.stepped[topic.topic.id]).at]?.id}
            onShow={(answer) => versions.show(topic.topic.id, answer)}
            onEarlier={() => void client.topics.earlier(topic.topic.id).catch(() => undefined)}
            onOpenAnswer={(turn) => onMove({ to: 'answer', turn })}
            now={now}
          />
        )
      return pane(
        'story',
        <Transcript
          exchanges={channel.exchanges}
          threads={threads.threads}
          personas={personas}
          onOpenAnswer={(turn) => onMove({ to: 'answer', turn })}
          onOpenThread={openThread}
        />
      )
    }
    if (place.opening) return pane('project', <ProjectForm client={client} onBack={() => onMove({ to: 'opening', opening: false })} onOpened={openThread} />)
    if (place.away) return pane('away', <TopicsAway client={client} onBack={() => onMove({ to: 'away', away: false })} />)
    if (opened !== undefined)
      return pane(
        `thread-${opened}`,
        <ThreadView
          client={client}
          thread={opened}
          threads={threads.threads}
          personas={personas}
          nav={{ onBack: () => openThread(undefined), onOpenThread: openThread }}
        />
      )
    if (topic)
      return pane(
        `work-${topic.topic.id}`,
        <TopicWork client={client} topic={topic.topic} threads={threads.threads} exchanges={channel.exchanges} personas={personas} />
      )
    return pane(
      'work',
      <ThreadList
        threads={threads}
        exchanges={channel.exchanges}
        selected={place.lastThread}
        onOpen={openThread}
        onStop={(thread) => void client.threads.stop(thread).catch(() => undefined)}
        onArchive={(thread, archived) => void client.threads.archive(thread, archived).catch(() => undefined)}
        onOpenProject={() => onMove({ to: 'opening', opening: true })}
      />
    )
  }

  return (
    <motion.aside
      aria-label="Side panel"
      initial={{ x: '100%', opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.6 }}
      transition={slide}
      // Its width follows the one the person chose, within what the window allows, without React drawing it again.
      data-sheet-width
      style={{ ...sheetWidthStyle(resize.width), width: sheetCssWidth(resize.keep) }}
      className="relative z-30 flex h-full min-w-0 shrink-0 flex-col border-line border-l bg-panel"
    >
      <SheetHandle {...resize} />
      {/* The panel's top is the window's top: the title row's height, dragging the window, with room kept on the right
          for the window's own buttons, which stand there whether it is open or not, and on Windows and Linux for the
          system's controls, drawn over it. */}
      <header
        className="drag flex h-[env(titlebar-area-height,var(--frame-title-bar))] shrink-0 items-center gap-2 pl-3"
        style={{ paddingRight: `calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + ${corner * CORNER_BUTTON}rem)` }}
      >
        {/* A container, so each tab can say its name only while the three names fit beside the window's buttons. */}
        <div role="tablist" aria-label="What the side panel shows" className="no-drag @container flex min-w-0 flex-1 items-stretch gap-3 self-stretch">
          {SHEET_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${ids}-${name}`}
              aria-selected={tab === name}
              aria-controls={tab === name ? `${ids}-panel` : undefined}
              // Chosen again, a tab goes back to its start.
              onClick={() => onMove({ to: 'tab', tab: name })}
              title={name === 'story' && storyKey !== '' ? `Story (${describeShortcut(storyKey, device.mac)})` : TITLES[name]}
              className={cn(
                'caps -outline-offset-2 flex min-w-0 items-center gap-1.5 px-1 transition-colors duration-(--duration-quick) ease-soft',
                tab === name ? 'text-text shadow-[inset_0_-2px_0_var(--color-text)]' : 'text-text-soft hover:text-text'
              )}
            >
              <span className="shrink-0">{GLYPHS[name]({})}</span>
              {/* The chosen tab always says its name; the others say theirs once the sheet is wide enough for all three,
                  else their glyph alone, named for the screen reader and the pointer. */}
              <span className={cn('truncate', tab !== name && 'sr-only @min-[20rem]:not-sr-only')}>{TITLES[name]}</span>
              {name === 'work' && working > 0 && (
                <span className="flex items-center gap-1 text-accent tabular-nums" title={`${working} at work`}>
                  <StateDot state="working" />
                  {working}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>
      {/* What it is the back of, and the choice between the topic in front and everything. */}
      <div className="grid shrink-0 gap-1.5 border-line border-t border-b px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="caps text-text-soft">The back of</span>
          <Choice<SheetScope> label="What this is the back of" value={place.scope} options={SCOPES} onChange={(scope) => onMove({ to: 'scope', scope })} />
        </div>
        <p className="display truncate text-[1.875rem] leading-[1.6875rem]" title={topic?.topic.title}>
          {topic ? topic.topic.title : place.scope === 'topic' ? 'No topic' : 'Everything'}
        </p>
        <p className="caps flex min-h-4 min-w-0 items-center gap-1.5 text-text-soft">
          {topic ? (
            <>
              <ProgressMark progress={topic.topic.progress} />
              <span className="min-w-0 truncate">
                {[
                  topic.topic.progress && PROGRESS_WORDS[topic.topic.progress],
                  many(topic.topic.answers, 'answer'),
                  behind.length > 0 && many(behind.length, 'thread'),
                  usedWords(topic.topic.at, now)
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          ) : place.scope === 'everything' ? (
            <>
              <span className="min-w-0 truncate">{`${many(topics.topics.length, 'topic')}${topics.more ? ' and more' : ''} · ${working} at work`}</span>
              <button
                type="button"
                onClick={() => onMove({ to: 'away', away: true })}
                className="caps ml-auto shrink-0 transition-colors duration-(--duration-quick) ease-soft hover:text-text"
              >
                Put away
              </button>
            </>
          ) : null}
        </p>
      </div>
      {shown()}
    </motion.aside>
  )
}
