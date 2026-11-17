import type { Client } from '@repo/client'
import { pinnedOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Persona } from '@repo/protocol'
import { motion } from 'motion/react'
import { ThreadList } from '../conversation/thread-list.tsx'
import { Transcript } from '../conversation/transcript.tsx'
import { Inspector } from '../inspector/inspector.tsx'
import type { LibraryControls } from '../library/library-context.ts'
import { PinnedList } from '../library/pinned-list.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Kbd } from '../primitives/kbd.tsx'
import type { ViewActions } from '../view/context.ts'

export const SHEET_TABS = ['pinned', 'transcript', 'threads', 'inspector'] as const
export type SheetTab = (typeof SHEET_TABS)[number]

const TITLES: Record<SheetTab, string> = { pinned: 'Pinned', transcript: 'Transcript', threads: 'Threads', inspector: 'Inspector' }

export interface SideSheetProps {
  client: Client
  personas: readonly Persona[]
  controls: LibraryControls
  actions: ViewActions
  tab: SheetTab
  onTab(tab: SheetTab): void
  onClose(): void
}

/**
 * The right side of the window, kept for what the user keeps beside the conversation. It slides over the stage
 * instead of pushing it, so the core and the view never move off centre: the pinned widgets first, then, one
 * step further in, what was said, the threads behind it, and the raw events.
 */
export function SideSheet({ client, personas, controls, actions, tab, onTab, onClose }: SideSheetProps) {
  const channel = useFollowed(client.channel)
  const threads = useFollowed(client.threads)
  const events = useFollowed(client.events)
  const library = useFollowed(client.library)
  const pinned = pinnedOf(library).length

  const counts: Record<SheetTab, number | undefined> = {
    pinned: pinned || undefined,
    transcript: undefined,
    threads: threads.threads.length || undefined,
    inspector: undefined
  }
  const subtitle: Record<SheetTab, string> = {
    pinned: pinned === 0 ? 'Kept beside the conversation' : `${pinned} live ${pinned === 1 ? 'widget' : 'widgets'}`,
    transcript: `${channel.exchanges.length} ${channel.exchanges.length === 1 ? 'exchange' : 'exchanges'}`,
    threads: threads.threads.length === 0 ? 'Topics behind the conversation' : `${threads.threads.filter((one) => one.state === 'working').length} working`,
    inspector: `${events.length} events from the core`
  }

  return (
    <motion.aside
      aria-label="Side sheet"
      initial={{ x: '100%', opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.6 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-y-0 right-0 z-30 flex w-[25rem] max-w-[calc(100%-3rem)] flex-col border-line-strong border-l bg-surface/92 shadow-[-40px_0_80px_-40px_rgb(0_0_0/0.85)] backdrop-blur-xl"
    >
      <header className="grid gap-3.5 border-line border-b px-4 pt-4 pb-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5 pl-0.5">
            <h2 className="font-medium text-lg leading-tight tracking-tight">{TITLES[tab]}</h2>
            <p className="truncate font-mono text-label text-text-faint uppercase">{subtitle[tab]}</p>
          </div>
          <div className="-mr-1 flex items-center gap-1.5">
            {tab === 'transcript' && <Kbd>Ctrl T</Kbd>}
            <IconButton label="Close the side sheet" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>
        </div>
        <div role="tablist" aria-label="What the side sheet shows" className="grid grid-cols-4 gap-0.5 rounded-md border border-line bg-ground/70 p-0.5">
          {SHEET_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => onTab(name)}
              className={cn(
                'relative flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs transition-colors duration-150',
                tab === name ? 'text-text' : 'text-text-faint hover:text-text-soft'
              )}
            >
              {tab === name && (
                <motion.span
                  layoutId="side-sheet-tab"
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 rounded-[5px] border border-line-strong bg-raised shadow-[0_1px_0_rgb(255_255_255/0.04)_inset]"
                />
              )}
              <span className="relative">{TITLES[name]}</span>
              {counts[name] !== undefined && (
                <span className={cn('relative font-mono text-[0.625rem] tabular-nums', tab === name ? 'text-accent' : 'text-text-faint')}>{counts[name]}</span>
              )}
            </button>
          ))}
        </div>
      </header>
      {tab === 'pinned' ? (
        <PinnedList controls={controls} actions={actions} />
      ) : tab === 'transcript' ? (
        <Transcript exchanges={channel.exchanges} personas={personas} />
      ) : tab === 'threads' ? (
        <ThreadList threads={threads} onFocus={(thread) => void client.threads.focus(thread).catch(() => undefined)} />
      ) : (
        <Inspector events={events} />
      )}
    </motion.aside>
  )
}
