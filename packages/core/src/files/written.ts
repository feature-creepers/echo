import type { ViewSpec } from '@repo/catalog'
import type { TurnId } from '@repo/protocol'
import type { Workspace, WorkspaceItem } from '../ports/workspace.ts'
import { folderName, partsFrom } from '../projects/folders.ts'
import type { Screen, Showing } from '../views/screen.ts'

/**
 * The files a thread makes or changes on the computer, shown as they are written (docs/SPEC.md, section 9.7): one
 * card for each turn, brought up to date with every file, listing each with its size and the ways to open it. The
 * card is composed from the generic blocks, like any view.
 */
interface WrittenFiles {
  /** A thread wrote files at these places, absolute: they go on the card of its turn. */
  add(showing: Showing, paths: readonly string[]): Promise<void>
}

/** How many files the card shows before folding the rest. */
const SHOWN = 5

/** How many turns' cards are kept current: an older turn's card is left as it was. */
const TURNS_KEPT = 20

/**
 * What the card says of where a file is: in the project the thread works on, or in the assistant's folder, then the
 * folders inside it. Nothing for a file elsewhere: its place on the computer is shown as it is.
 */
function detailOf(item: WorkspaceItem, workspace: Workspace, project?: string): string | undefined {
  const inProject = project === undefined ? undefined : partsFrom(project, item.location)
  if (inProject !== undefined && project !== undefined) return ['In', [folderName(project), ...inProject.slice(0, -1)].join(' › ')].join(' ')
  const path = workspace.pathOf(item.location)
  if (path === undefined) return undefined
  const folders = path.split('/').slice(0, -1)
  return folders.length === 0 ? "In the assistant's folder" : `In the assistant's folder › ${folders.join(' › ')}`
}

/** The card: the files written, newest last, with what the person can do with each. */
export function writtenCard(items: readonly WorkspaceItem[], workspace: Workspace, project?: string): { title: string; spec: ViewSpec } {
  const files = items.map((item) => {
    const detail = detailOf(item, workspace, project)
    return { path: item.location, name: item.name, size: item.size, ...(detail === undefined ? {} : { detail }) }
  })
  return {
    title: items.length === 1 ? 'File written' : `${items.length} files written`,
    spec: { root: 'files', elements: { files: { type: 'FileList', props: { files, limit: SHOWN }, children: [] } } } as ViewSpec
  }
}

interface WrittenFilesOptions {
  screen: Screen
  workspace: Workspace
  newId: () => string
  /** The folder a thread works in, when it works on a project: its files are named from there. */
  projectOf?: (thread: string | undefined) => string | undefined
}

export function createWrittenFiles({ screen, workspace, newId, projectOf }: WrittenFilesOptions): WrittenFiles {
  /** Each turn's card, and the files on it in the order they were first written. */
  const cards = new Map<TurnId | string, { view: string; items: WorkspaceItem[] }>()
  /** Cards are brought up to date one write at a time, in the order the writes ended. */
  let queue: Promise<void> = Promise.resolve()

  const add = async (showing: Showing, paths: readonly string[]) => {
    const found = (await Promise.all(paths.map((path) => workspace.about(path)))).filter((item) => item?.kind === 'file') as WorkspaceItem[]
    if (found.length === 0) return
    const key = showing.turn ?? `${showing.thread ?? ''}:${newId()}`
    const card = cards.get(key) ?? { view: newId(), items: [] }
    for (const item of found) {
      const at = card.items.findIndex((known) => known.location === item.location)
      if (at < 0) card.items.push(item)
      else card.items[at] = item
    }
    cards.delete(key)
    cards.set(key, card)
    for (const old of [...cards.keys()].slice(0, Math.max(0, cards.size - TURNS_KEPT))) cards.delete(old)
    screen.present({ id: card.view, ...writtenCard(card.items, workspace, projectOf?.(showing.thread)) }, showing)
  }

  return {
    add(showing, paths) {
      const next = queue.then(() => add(showing, paths))
      queue = next.catch(() => undefined)
      return next
    }
  }
}
