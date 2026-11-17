import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { Persona } from '@repo/protocol'
import { motion } from 'motion/react'
import { useState } from 'react'
import { ThreadList } from '../conversation/thread-list.tsx'
import { ThreadView } from '../conversation/thread-view.tsx'
import { Transcript } from '../conversation/transcript.tsx'
import { Inspector } from '../inspector/inspector.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CloseGlyph } from '../primitives/icons.tsx'
import { Kbd } from '../primitives/kbd.tsx'

export const SHEET_TABS = ['transcript', 'threads', 'inspector'] as const
export type SheetTab = (typeof SHEET_TABS)[number]

const TITLES: Record<SheetTab, string> = { transcript: 'Transcript', threads: 'Threads', inspector: 'Inspector' }

export interface SideSheetProps {
  client: Client
  personas: readonly Persona[]
  tab: SheetTab
  onTab(tab: SheetTab): void
  onClose(): void
}

/**
 * The right side of the window, for advanced use: what was said, the threads behind the conversation with all
 * their work, and the raw events. It slides over the stage instead of pushing it, so the core and the view never
 * move off centre. What the user keeps at hand, pinned widgets, stays on the main screen.
 */
export function SideSheet({ client, personas, tab, onTab, onClose }: SideSheetProps) {
  const channel = useFollowed(client.channel)
  const threads = useFollowed(client.threads)
  const events = useFollowed(client.events)
  /** The thread opened in the Threads tab, kept while the user looks at another tab. */
  const [opened, setOpened] = useState<string>()

  const counts: Record<SheetTab, number | undefined> = {
    transcript: undefined,
    threads: threads.threads.length || undefined,
    inspector: undefined
  }
  const subtitle: Record<SheetTab, string> = {
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
      className="material absolute inset-y-0 right-0 z-30 flex w-[27rem] max-w-[calc(100%-3rem)] flex-col border-black/50 border-l shadow-[-20px_0_40px_-24px_rgb(0_0_0/0.7)]"
    >
      <header className="grid gap-3 border-white/[0.06] border-b px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-0.5 pl-0.5">
            <h2 className="font-semibold text-[0.9375rem] leading-tight tracking-[-0.01em]">{TITLES[tab]}</h2>
            <p className="truncate text-text-faint text-xs">{subtitle[tab]}</p>
          </div>
          <div className="-mr-1 flex items-center gap-1.5">
            {tab === 'transcript' && <Kbd>Ctrl T</Kbd>}
            <IconButton label="Close the side sheet" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>
        </div>
        <div
          role="tablist"
          aria-label="What the side sheet shows"
          className="grid grid-cols-3 rounded-md bg-white/[0.06] p-0.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]"
        >
          {SHEET_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => onTab(name)}
              className={cn(
                'relative flex h-6 items-center justify-center gap-1.5 rounded-sm text-xs transition-colors duration-150',
                tab === name ? 'text-text' : 'text-text-soft hover:text-text'
              )}
            >
              {tab === name && (
                <motion.span
                  layoutId="side-sheet-tab"
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 rounded-sm bg-white/[0.13] shadow-[0_1px_2px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.06)]"
                />
              )}
              <span className="relative">{TITLES[name]}</span>
              {counts[name] !== undefined && (
                <span className={cn('relative text-[0.6875rem] tabular-nums', tab === name ? 'text-text-soft' : 'text-text-faint')}>{counts[name]}</span>
              )}
            </button>
          ))}
        </div>
      </header>
      {tab === 'transcript' ? (
        <Transcript exchanges={channel.exchanges} personas={personas} />
      ) : tab === 'threads' ? (
        opened && threads.threads.some((thread) => thread.id === opened) ? (
          <ThreadView key={opened} client={client} thread={opened} personas={personas} onBack={() => setOpened(undefined)} />
        ) : (
          <ThreadList threads={threads} onOpen={setOpened} />
        )
      ) : (
        <Inspector events={events} />
      )}
    </motion.aside>
  )
}
