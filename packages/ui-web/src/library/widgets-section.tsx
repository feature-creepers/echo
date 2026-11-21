import type { ViewSpec } from '@repo/catalog'
import { collectionsOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { SavedWidget } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { BookmarkGlyph, PinGlyph } from '../primitives/icons.tsx'
import { SearchField } from '../primitives/search-field.tsx'
import { EmptyPlane } from '../settings/rows.tsx'
import { DURATION, EASE } from '../styles/motion.ts'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'
import { WidgetDialog } from './widget-dialog.tsx'

/** Which widgets the section lists. */
type Shelf = { is: 'all' } | { is: 'pinned' } | { is: 'unfiled' } | { is: 'collection'; name: string }

export interface WidgetsSectionProps {
  controls: LibraryControls
  /** What the blocks of a widget can do. Nothing starts by itself here. */
  actions: ViewActions
  /** The widget to open on. */
  selected?: string | undefined
  /** Ask the assistant something, from the main screen: to change a widget. */
  onAsk(text: string): void
  /** A widget was put on the stage: the library goes back to the conversation to show it. */
  onShown(): void
}

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** Text as a search compares it: without accents, in lower case. */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The words of a widget a search looks in: its title, its collection, and every text it shows. */
function wordsOf(widget: SavedWidget): string {
  const texts: string[] = [widget.title, widget.collection ?? '']
  const walk = (value: unknown) => {
    if (typeof value === 'string') texts.push(value)
    else if (Array.isArray(value)) for (const item of value) walk(item)
    else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) walk(item)
  }
  for (const element of Object.values(widget.spec.elements)) walk(element.props)
  return plain(texts.join(' '))
}

/**
 * The widgets page of the library: the views the user bookmarked, to find again, sort into their own
 * collections, rename, pin to the main screen, or delete. Each one is drawn live, as it was saved. Opened, a
 * widget covers the library in a dialog, which Escape closes before the library.
 */
export function WidgetsSection({ controls, actions, selected, onAsk, onShown }: WidgetsSectionProps) {
  const library = useFollowed(controls.library)
  const [shelf, setShelf] = useState<Shelf>({ is: 'all' })
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | undefined>(selected)
  const widgets = library?.widgets ?? []
  const collections = collectionsOf(library)
  const openWidget = widgets.find((widget) => widget.id === open)

  useEffect(() => setOpen(selected), [selected])

  const shown = useMemo(() => {
    const words = plain(query).split(/\s+/).filter(Boolean)
    return widgets.filter((widget) => {
      if (shelf.is === 'pinned' && !widget.pinned) return false
      if (shelf.is === 'unfiled' && widget.collection) return false
      if (shelf.is === 'collection' && widget.collection !== shelf.name) return false
      if (words.length === 0) return true
      const text = wordsOf(widget)
      return words.every((word) => text.includes(word))
    })
  }, [widgets, shelf, query])

  if (widgets.length === 0) return <Empty />

  const counts = { all: widgets.length, pinned: widgets.filter((one) => one.pinned).length, unfiled: widgets.filter((one) => !one.collection).length }
  const on = (other: Shelf) => shelf.is === other.is && (shelf.is !== 'collection' || (other.is === 'collection' && shelf.name === other.name))

  return (
    <div className="grid gap-4">
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search by title, collection or anything a widget shows"
        label="Search the widgets"
        className="h-8"
      />

      {/* A scope bar, as in a native browser of files: every shelf in sight, the chosen one raised. */}
      <div role="toolbar" aria-label="Shelves" className="flex flex-wrap items-center gap-1">
        <ShelfButton on={on({ is: 'all' })} count={counts.all} onClick={() => setShelf({ is: 'all' })}>
          All
        </ShelfButton>
        <ShelfButton on={on({ is: 'pinned' })} count={counts.pinned} onClick={() => setShelf({ is: 'pinned' })}>
          Pinned
        </ShelfButton>
        <ShelfButton on={on({ is: 'unfiled' })} count={counts.unfiled} onClick={() => setShelf({ is: 'unfiled' })}>
          Unfiled
        </ShelfButton>
        {collections.length > 0 && <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-line" />}
        {collections.map((collection) => (
          <ShelfButton
            key={collection.name}
            on={on({ is: 'collection', name: collection.name })}
            count={collection.count}
            onClick={() => setShelf({ is: 'collection', name: collection.name })}
          >
            {collection.name}
          </ShelfButton>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="caps py-16 text-center text-text-soft">No widget here{query ? ` matches “${query}”` : ''}</p>
      ) : (
        <ul className="grid gap-x-5 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          <AnimatePresence initial={false}>
            {shown.map((widget) => (
              <motion.li
                key={widget.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.quick, ease: EASE } }}
                transition={{ duration: DURATION.calm, ease: EASE }}
              >
                <Tile widget={widget} actions={actions} onOpen={() => setOpen(widget.id)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {openWidget && (
        <WidgetDialog
          key={openWidget.id}
          widget={openWidget}
          collections={collections.map((collection) => collection.name)}
          controls={controls}
          actions={actions}
          onAsk={(text) => {
            setOpen(undefined)
            onAsk(text)
          }}
          onShown={onShown}
          onClose={() => setOpen(undefined)}
        />
      )}
    </div>
  )
}

function ShelfButton({ on, count, onClick, children }: { on: boolean; count: number; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex h-6 max-w-48 items-center gap-1.5 px-2 text-xs transition-colors duration-(--duration-quick) ease-soft',
        on ? 'bg-text text-ground' : 'text-text-soft hover:bg-text/[0.08] hover:text-text'
      )}
    >
      <span className="truncate">{children}</span>
      <span className={cn('caps', on ? 'text-ground' : 'text-text-faint')}>{count}</span>
    </button>
  )
}

/** A saved widget as a tile: under a rule of the ink, a live miniature of it, its title, where it is filed. Pressing it opens it. */
function Tile({ widget, actions, onOpen }: { widget: SavedWidget; actions: ViewActions; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full overflow-hidden border-text border-t-2 text-left transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.06] active:bg-text/[0.1]"
    >
      <div className="h-36 overflow-hidden border-line border-b">
        {/* A miniature, not to be used: the widget is used once opened. */}
        <div inert className="pointer-events-none p-5 [zoom:0.62]">
          <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
        </div>
      </div>
      <div className="grid gap-0.5 py-2.5">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-[0.8125rem]">{widget.title}</span>
          {widget.pinned && (
            <span title="Pinned to the main screen" className="shrink-0 text-text-soft [&_svg]:size-3">
              <PinGlyph filled />
            </span>
          )}
        </span>
        <span className="caps flex items-center gap-1.5 text-text-faint">
          <span className="truncate">{widget.collection ?? 'Unfiled'}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={widget.since} className="shrink-0">
            {day.format(new Date(widget.since))}
          </time>
        </span>
      </div>
    </button>
  )
}

function Empty() {
  return (
    <EmptyPlane>
      <span className="mx-auto text-text [&_svg]:size-4">
        <BookmarkGlyph />
      </span>
      <p className="caps text-text">Keep the views you like</p>
      <p className="text-balance">
        Press the bookmark on anything the assistant shows. It lands here, to sort into collections, pin beside the conversation, and ask for again: the
        assistant brings back the same one.
      </p>
    </EmptyPlane>
  )
}
