import type { ViewSpec } from '@repo/catalog'
import { collectionsOf } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { SavedWidget } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { BookmarkGlyph, PinGlyph, SearchGlyph } from '../primitives/icons.tsx'
import { ScreenHeader } from '../primitives/screen-header.tsx'
import { Sidebar, SidebarItem } from '../primitives/sidebar.tsx'
import { EASE } from '../styles/motion.ts'
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
 * The views the user bookmarked: to find again, sort into their own collections, rename, pin to the main
 * screen, or delete. Each one is drawn live, as it was saved.
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

  const title = shelf.is === 'all' ? 'All widgets' : shelf.is === 'pinned' ? 'Pinned' : shelf.is === 'unfiled' ? 'Unfiled' : shelf.name
  const counts = { all: widgets.length, pinned: widgets.filter((one) => one.pinned).length, unfiled: widgets.filter((one) => !one.collection).length }

  return (
    <section aria-label="Library" className="relative flex h-full w-full">
      <Sidebar title="Library" label="Shelves">
        <div className="grid gap-px">
          <SidebarItem detail={counts.all} on={shelf.is === 'all'} onClick={() => setShelf({ is: 'all' })}>
            All widgets
          </SidebarItem>
          <SidebarItem detail={counts.pinned} on={shelf.is === 'pinned'} onClick={() => setShelf({ is: 'pinned' })}>
            Pinned
          </SidebarItem>
          <SidebarItem detail={counts.unfiled} on={shelf.is === 'unfiled'} onClick={() => setShelf({ is: 'unfiled' })}>
            Unfiled
          </SidebarItem>
        </div>
        <div className="grid gap-px">
          <span className="mb-0.5 px-2.5 font-semibold text-[0.6875rem] text-text-faint">Collections</span>
          {collections.length === 0 ? (
            <p className="px-2.5 text-text-faint text-xs leading-relaxed">Open a widget and give it a collection to start one.</p>
          ) : (
            collections.map((collection) => (
              <SidebarItem
                key={collection.name}
                detail={collection.count}
                on={shelf.is === 'collection' && shelf.name === collection.name}
                onClick={() => setShelf({ is: 'collection', name: collection.name })}
              >
                {collection.name}
              </SidebarItem>
            ))
          )}
        </div>
      </Sidebar>

      <div className="scroll-quiet min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-(--window) px-10 pt-7 pb-16">
        <ScreenHeader
          title={title}
          detail={widgets.length === 0 ? 'Nothing saved yet.' : `${shown.length} of ${widgets.length} ${widgets.length === 1 ? 'widget' : 'widgets'}`}
          closeLabel="Close the library"
          onClose={onClose}
        />
        {/* The search spans the column under the title, where the eye goes next; the close button keeps its corner. */}
        {widgets.length > 0 && (
          <label className="mt-5 mb-5 flex h-8 items-center gap-2 rounded-md bg-white/[0.06] px-2.5 text-text-faint shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.08)] transition-shadow duration-(--duration-quick) focus-within:text-text-soft focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_55%,transparent)] [&_svg]:size-3.5">
            <SearchGlyph />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, collection or anything a widget shows"
              aria-label="Search the library"
              className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-text outline-none placeholder:text-text-faint focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        )}

        {widgets.length === 0 ? (
          <Empty />
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-text-soft">No widget here{query ? ` matches “${query}”` : ''}.</p>
        ) : (
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            <AnimatePresence initial={false}>
              {shown.map((widget) => (
                <motion.li
                  key={widget.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
                  transition={{ duration: 0.28, ease: EASE }}
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

/** A saved widget as a tile: a live miniature of it, its title, where it is filed. Pressing it opens it. */
function Tile({ widget, actions, onOpen }: { widget: SavedWidget; actions: ViewActions; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full overflow-hidden rounded-lg bg-surface text-left shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_6px_18px_-12px_rgb(0_0_0/0.7)] transition-shadow duration-(--duration-calm) ease-soft hover:shadow-[0_0_0_1px_rgb(255_255_255/0.12),0_10px_24px_-12px_rgb(0_0_0/0.8)]"
    >
      <div className="relative h-36 overflow-hidden border-line border-b bg-black/20">
        {/* A miniature, not to be used: the widget is used once opened. */}
        <div inert className="pointer-events-none p-5 [zoom:0.62]">
          <ViewRenderer spec={widget.spec as ViewSpec} actions={actions} />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ground to-transparent" />
      </div>
      <div className="grid gap-0.5 px-3 py-2.5">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate font-medium text-[0.8125rem]">{widget.title}</span>
          {widget.pinned && (
            <span title="Pinned to the main screen" className="shrink-0 text-text-soft [&_svg]:size-3">
              <PinGlyph filled />
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-[0.6875rem] text-text-faint">
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
    <div className="mt-6 grid justify-items-center gap-3 rounded-lg border border-line border-dashed px-8 py-16 text-center">
      <span className="flex size-9 items-center justify-center rounded-md border border-line-strong bg-raised text-text-soft [&_svg]:size-4">
        <BookmarkGlyph />
      </span>
      <div className="grid max-w-md gap-1.5">
        <p className="font-medium text-sm">Keep the views you like</p>
        <p className="text-balance text-[0.8125rem] text-text-soft leading-relaxed">
          Press the bookmark on anything the assistant shows. It lands here, to sort into collections, pin to the main screen, and ask for again: the assistant
          brings back the same one.
        </p>
      </div>
    </div>
  )
}
