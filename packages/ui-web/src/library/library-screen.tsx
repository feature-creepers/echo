import type { ViewSpec } from '@repo/catalog'
import { collectionsOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { SavedWidget } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { BookmarkGlyph, CloseGlyph, PinGlyph, SearchGlyph } from '../primitives/icons.tsx'
import { Kbd } from '../primitives/kbd.tsx'
import type { ViewActions } from '../view/context.ts'
import { ViewRenderer } from '../view/view-renderer.tsx'
import type { LibraryControls } from './library-context.ts'
import { WidgetDialog } from './widget-dialog.tsx'

/** Which widgets the screen lists. */
type Shelf = { is: 'all' } | { is: 'pinned' } | { is: 'unfiled' } | { is: 'collection'; name: string }

export interface LibraryScreenProps {
  controls: LibraryControls
  /** What the blocks of a widget can do. Nothing starts by itself here. */
  actions: ViewActions
  /** The widget to open on. */
  selected?: string | undefined
  /** Ask the assistant something, from the main screen: to change a widget. */
  onAsk(text: string): void
  onClose(): void
}

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** The words of a widget a search looks in: its title, its collection, and every text it shows. */
function wordsOf(widget: SavedWidget): string {
  const texts: string[] = [widget.title, widget.collection ?? '']
  const walk = (value: unknown) => {
    if (typeof value === 'string') texts.push(value)
    else if (Array.isArray(value)) for (const item of value) walk(item)
    else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) walk(item)
  }
  for (const element of Object.values(widget.spec.elements)) walk(element.props)
  return texts.join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The views the user bookmarked: to find again, sort into their own collections, rename, pin beside the
 * conversation, or delete. Each one is drawn live, as it was saved.
 */
export function LibraryScreen({ controls, actions, selected, onAsk, onClose }: LibraryScreenProps) {
  const library = useFollowed(controls.library)
  const [shelf, setShelf] = useState<Shelf>({ is: 'all' })
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | undefined>(selected)
  const widgets = library?.widgets ?? []
  const collections = collectionsOf(library)
  const openWidget = widgets.find((widget) => widget.id === open)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !open) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  const shown = useMemo(() => {
    const words = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/\s+/).filter(Boolean)
    return widgets.filter((widget) => {
      if (shelf.is === 'pinned' && !widget.pinned) return false
      if (shelf.is === 'unfiled' && widget.collection) return false
      if (shelf.is === 'collection' && widget.collection !== shelf.name) return false
      if (words.length === 0) return true
      const text = wordsOf(widget)
      return words.every((word) => text.includes(word))
    })
  }, [widgets, shelf, query])

  const title = shelf.is === 'all' ? 'Library' : shelf.is === 'pinned' ? 'Pinned' : shelf.is === 'unfiled' ? 'Unfiled' : shelf.name
  const counts = { all: widgets.length, pinned: widgets.filter((one) => one.pinned).length, unfiled: widgets.filter((one) => !one.collection).length }

  return (
    <section aria-label="Library" className="relative mx-auto flex h-full w-full max-w-6xl gap-12 px-8 pt-10">
      <nav aria-label="Shelves" className="grid w-48 shrink-0 content-start gap-1">
        <Eyebrow className="mb-3 px-3">Library</Eyebrow>
        <ShelfButton label="All widgets" count={counts.all} on={shelf.is === 'all'} onClick={() => setShelf({ is: 'all' })} />
        <ShelfButton label="Pinned" count={counts.pinned} on={shelf.is === 'pinned'} onClick={() => setShelf({ is: 'pinned' })} />
        <ShelfButton label="Unfiled" count={counts.unfiled} on={shelf.is === 'unfiled'} onClick={() => setShelf({ is: 'unfiled' })} />
        <Eyebrow className="mt-6 mb-2 px-3">Collections</Eyebrow>
        {collections.length === 0 ? (
          <p className="px-3 text-text-faint text-xs leading-relaxed">Open a widget and give it a collection to start one.</p>
        ) : (
          collections.map((collection) => (
            <ShelfButton
              key={collection.name}
              label={collection.name}
              count={collection.count}
              on={shelf.is === 'collection' && shelf.name === collection.name}
              onClick={() => setShelf({ is: 'collection', name: collection.name })}
            />
          ))
        )}
      </nav>

      <div className="scroll-quiet min-w-0 flex-1 overflow-y-auto pb-16">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="font-medium text-3xl tracking-tight">{title}</h1>
            <p className="text-sm text-text-soft">
              {widgets.length === 0 ? 'Nothing saved yet.' : `${shown.length} of ${widgets.length} ${widgets.length === 1 ? 'widget' : 'widgets'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex h-9 w-64 items-center gap-2 rounded-md border border-line-strong bg-ground/80 px-3 text-text-faint transition focus-within:border-accent focus-within:text-text">
              <SearchGlyph />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the library"
                aria-label="Search the library"
                className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
              />
            </label>
            <Kbd>esc</Kbd>
            <IconButton label="Close the library" onClick={onClose}>
              <CloseGlyph />
            </IconButton>
          </div>
        </div>

        {widgets.length === 0 ? (
          <Empty />
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-text-soft">No widget here{query ? ` matches “${query}”` : ''}.</p>
        ) : (
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]">
            <AnimatePresence initial={false}>
              {shown.map((widget) => (
                <motion.li
                  key={widget.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Tile widget={widget} actions={actions} onOpen={() => setOpen(widget.id)} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <AnimatePresence>
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
            onShown={onClose}
            onClose={() => setOpen(undefined)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function ShelfButton({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-current={on}
      onClick={onClick}
      className={cn(
        'relative flex h-9 items-center justify-between gap-3 rounded-sm px-3 text-left text-sm transition duration-150 ease-soft',
        on
          ? 'bg-raised text-text before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
          : 'text-text-soft hover:bg-raised/60 hover:text-text'
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn('font-mono text-[0.6875rem] tabular-nums', on ? 'text-accent' : 'text-text-faint')}>{count}</span>
    </button>
  )
}

/** A saved widget as a tile: a live miniature of it, its title, where it is filed. Pressing it opens it. */
function Tile({ widget, actions, onOpen }: { widget: SavedWidget; actions: ViewActions; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full overflow-hidden rounded-lg border border-line bg-surface/60 text-left transition duration-200 ease-soft hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface/90 hover:shadow-[0_24px_60px_-40px_var(--accent)]"
    >
      <div className="relative h-44 overflow-hidden border-line border-b bg-ground/40">
        {/* A miniature, not to be used: the widget is used once opened. */}
        <div inert className="pointer-events-none origin-top-left p-5 [zoom:0.6]">
          <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />
      </div>
      <div className="grid gap-1 px-4 py-3">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate font-medium text-[0.9375rem]">{widget.title}</span>
          {widget.pinned && (
            <span title="Pinned to the side" className="shrink-0 text-accent [&_svg]:size-3.5">
              <PinGlyph filled />
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 font-mono text-label text-text-faint uppercase">
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
    <div className="grid justify-items-center gap-4 rounded-xl border border-line border-dashed px-8 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-line-strong bg-raised text-accent [&_svg]:size-5">
        <BookmarkGlyph />
      </span>
      <div className="grid max-w-md gap-1.5">
        <p className="font-medium">Keep the views you like</p>
        <p className="text-balance text-sm text-text-soft leading-relaxed">
          Press the bookmark on anything the assistant shows. It lands here, to sort into collections, pin beside the conversation, and ask for again: the
          assistant brings back the same one.
        </p>
      </div>
    </div>
  )
}
