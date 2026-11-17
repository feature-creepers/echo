import type { CommandInput, LibraryView, SavedWidget } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** The user's library of saved widgets, kept current for as long as the session lasts. Nothing until the core has answered. */
export interface LibraryState extends Followed<LibraryView | undefined> {
  /** Save a view shown now or earlier. Gives back the widget it became. */
  save(view: string, title?: string): Promise<SavedWidget>
  /** Rename, file, pin or unpin a widget. */
  update(change: CommandInput<'library.update'>): Promise<void>
  remove(widget: string): Promise<void>
  /** Show a saved widget on the stage. */
  show(widget: string): Promise<void>
  unfollow(): void
}

/**
 * Read the library from the core and follow its changes, from this device or another. Two copies can cross on
 * the way, one read and one announced: the later revision wins.
 */
export function followLibrary(session: Session): LibraryState {
  const library = cell<LibraryView | undefined>(undefined)
  const accept = (view: LibraryView) => {
    const known = library.current()
    if (known && known.revision >= view.revision) return
    library.set(view)
  }
  const stopEvents = session.onEvent((event) => {
    if (event.name === 'library.changed') accept(event.library)
  })
  session.run('library.read', {}).then(
    ({ library: view }) => accept(view),
    () => undefined
  )
  return {
    current: library.current,
    subscribe: library.subscribe,
    async save(view, title) {
      const saved = await session.run('library.save', title === undefined ? { view } : { view, title })
      accept(saved.library)
      return saved.widget
    },
    async update(change) {
      accept((await session.run('library.update', change)).library)
    },
    async remove(widget) {
      accept((await session.run('library.delete', { widget })).library)
    },
    async show(widget) {
      await session.run('library.show', { widget })
    },
    unfollow: stopEvents
  }
}

/** The widget a view was saved as, or shows again, if it is in the library. */
export function savedAs(library: LibraryView | undefined, view: { id: string; widget?: string | undefined }): SavedWidget | undefined {
  return library?.widgets.find((widget) => widget.id === view.widget || widget.from === view.id)
}

/** The pinned widgets, in the order they were pinned. */
export function pinnedOf(library: LibraryView | undefined): SavedWidget[] {
  return (library?.widgets ?? []).filter((widget) => widget.pinned).sort((one, other) => (one.pinnedAt ?? '').localeCompare(other.pinnedAt ?? ''))
}

/** The collections the user made, by name, each with how many widgets it holds. */
export function collectionsOf(library: LibraryView | undefined): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const widget of library?.widgets ?? []) if (widget.collection) counts.set(widget.collection, (counts.get(widget.collection) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((one, other) => one.name.localeCompare(other.name))
}
