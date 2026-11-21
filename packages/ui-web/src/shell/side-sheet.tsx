import type { Client } from '@repo/client'
import { describeShortcut } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Persona } from '@repo/protocol'
import { motion } from 'motion/react'
import { type ReactNode, useId } from 'react'
import { FullAnswer } from '../conversation/full-answer.tsx'
import { ProjectForm } from '../conversation/project-form.tsx'
import { StateDot, ThreadList } from '../conversation/thread-list.tsx'
import { ThreadView } from '../conversation/thread-view.tsx'
import { Transcript } from '../conversation/transcript.tsx'
import { useDevice } from '../device/device.tsx'
import { Inspector } from '../inspector/inspector.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, settle, slide } from '../styles/motion.ts'
import { SheetHandle } from './sheet-handle.tsx'
import { SHEET_TABS, type SheetMove, type SheetPlace, type SheetTab } from './sheet-place.ts'
import { SHEET_CSS_WIDTH, sheetWidthStyle } from './sheet-width.ts'

const TITLES: Record<SheetTab, string> = { transcript: 'Transcript', threads: 'Threads', inspector: 'Inspector' }

interface SideSheetProps {
  client: Client
  personas: readonly Persona[]
  /** Where the sheet stands: the tab it shows, and where each tab is. */
  place: SheetPlace
  /** The tab it shows. */
  tab: SheetTab
  onMove(move: SheetMove): void
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
 * The right side of the window, for advanced use: what was said, the threads behind the conversation with all
 * their work, and the raw events. It takes its width from the window, and the screen beside it narrows, so nothing
 * is ever under it, whatever screen is showing. Its left edge resizes it. What the person keeps
 * at hand, pinned widgets, stays on the main screen.
 *
 * Its header is the tabs alone, with the way to close it: each tab says what it shows, so no title repeats it, and
 * what a tab can do (find a thread, open a project, sift the events) sits at the top of the tab itself.
 */
export function SideSheet({ client, personas, place, tab, onMove, resize }: SideSheetProps) {
  const channel = useFollowed(client.channel)
  const threads = useFollowed(client.threads)
  const device = useDevice()
  const ids = useId()
  const transcriptKey = device.settings.shortcuts.transcript
  const working = threads.threads.filter((thread) => thread.state === 'working').length
  const answered = place.answer === undefined ? undefined : channel.exchanges.find((exchange) => exchange.turn === place.answer)
  // A thread no longer kept shows the list instead.
  const opened = place.thread !== undefined && threads.threads.some((thread) => thread.id === place.thread) ? place.thread : undefined
  const openThread = (thread: string | undefined) => onMove({ to: 'thread', thread })

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

  /** The place the tab shows: in the transcript, the log or a full answer; in the threads, the list, a thread or the project form. */
  const shown = (): ReactNode => {
    if (tab === 'inspector') return pane('inspector', <Inspector client={client} />)
    if (tab === 'transcript') {
      if (place.answer === undefined) {
        return pane(
          'transcript',
          <Transcript
            exchanges={channel.exchanges}
            threads={threads.threads}
            personas={personas}
            onOpenAnswer={(turn) => onMove({ to: 'answer', turn })}
            onOpenThread={openThread}
          />
        )
      }
      return pane(
        `answer-${place.answer}`,
        <FullAnswer
          exchange={answered}
          title={threads.threads.find((thread) => thread.id === answered?.thread)?.title}
          persona={personas.find((persona) => persona.id === answered?.persona)}
          onBack={() => onMove({ to: 'answer', turn: undefined })}
        />
      )
    }
    if (place.opening) return pane('project', <ProjectForm client={client} onBack={() => onMove({ to: 'opening', opening: false })} onOpened={openThread} />)
    if (opened !== undefined) {
      return pane(
        `thread-${opened}`,
        <ThreadView
          client={client}
          thread={opened}
          threads={threads.threads}
          personas={personas}
          onBack={() => openThread(undefined)}
          onOpenThread={openThread}
        />
      )
    }
    return pane(
      'threads',
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
      aria-label="Side sheet"
      initial={{ x: '100%', opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.6 }}
      transition={slide}
      // Its width follows the one the person chose, within what the window allows, without React drawing it again.
      data-sheet-width
      style={{ ...sheetWidthStyle(resize.width), width: SHEET_CSS_WIDTH }}
      className="material relative z-30 flex h-full min-w-0 shrink-0 flex-col border-black/50 border-l"
    >
      <SheetHandle {...resize} />
      <header className="flex items-center gap-2 border-white/[0.06] border-b py-2.5 pr-2.5 pl-3">
        <div
          role="tablist"
          aria-label="What the side sheet shows"
          className="grid min-w-0 flex-1 grid-cols-3 rounded-md bg-white/[0.06] p-0.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]"
        >
          {SHEET_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${ids}-${name}`}
              aria-selected={tab === name}
              aria-controls={tab === name ? `${ids}-panel` : undefined}
              // Chosen again, a tab goes back to its start: the log, or the list of threads.
              onClick={() => onMove({ to: 'tab', tab: name })}
              title={name === 'transcript' && transcriptKey !== '' ? `Transcript (${describeShortcut(transcriptKey, device.mac)})` : undefined}
              className={cn(
                'relative flex h-6 min-w-0 items-center justify-center gap-1.5 rounded-sm text-xs transition-colors duration-(--duration-quick)',
                tab === name ? 'text-text' : 'text-text-soft hover:text-text'
              )}
            >
              {tab === name && (
                <motion.span
                  layoutId="side-sheet-tab"
                  transition={{ duration: DURATION.calm, ease: EASE }}
                  className="absolute inset-0 rounded-sm bg-white/[0.13] shadow-[0_1px_2px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)]"
                />
              )}
              <span className="relative truncate">{TITLES[name]}</span>
              {name === 'threads' && working > 0 && (
                <span className="relative flex items-center gap-1 text-[0.6875rem] tabular-nums" title={`${working} at work`}>
                  <StateDot state="working" />
                  <span className={tab === name ? 'text-text-soft' : 'text-text-faint'}>{working}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <IconButton label="Close the side sheet" onClick={() => onMove({ to: 'close' })}>
          <CloseGlyph />
        </IconButton>
      </header>
      {shown()}
    </motion.aside>
  )
}
