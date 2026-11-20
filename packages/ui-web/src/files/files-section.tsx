import { type Client, runsWhenOpened } from '@repo/client'
import type { WorkspaceEntry } from '@repo/protocol'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { IconButton } from '../primitives/icon-button.tsx'
import { CheckGlyph } from '../primitives/icons.tsx'
import { copyText, saveCopy } from './file-actions.ts'
import { FileContent, FileMark } from './file-content.tsx'
import { CopyGlyph, DisclosureGlyph, DownloadGlyph, FileGlyph, FolderGlyph, OpenGlyph, RefreshGlyph, RevealGlyph, VersionsGlyph } from './glyphs.tsx'
import { kindOf } from './kinds.ts'
import { type Listing, moveFor, type Row, visibleRows } from './tree.ts'
import { Versions } from './versions.tsx'
import { itemsWords, modifiedWords, sizeWords } from './words.ts'

/**
 * The assistant's own folder, as a file manager shows it (docs/SPEC.md, section 9.7): its folders and files in a
 * list whose folders fold open, the one selected shown beside it, and what can be done with each. It is read again
 * when the page opens, when the window comes back to the front, and when the core says something in it changed.
 */
export function FilesSection({ client, productName }: { client: Client; productName: string }) {
  const { host } = useDevice()
  const files = host?.files
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(new Map([['', { is: 'reading' }]]))
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string>()
  // The folders open now, for a refresh that reads them again without being made anew each time one opens.
  const opened = useRef(open)
  opened.current = open

  const read = useCallback(
    async (path: string) => {
      try {
        const { folder, entries } = await client.session.run('workspace.list', { path })
        setListings((known) => new Map(known).set(path, { is: 'listed', folder, entries }))
      } catch (error) {
        setListings((known) => new Map(known).set(path, { is: 'failed', problem: error instanceof Error ? error.message : String(error) }))
      }
    },
    [client]
  )

  /** Read again the top and every folder open, keeping what was shown until the new listing arrives. */
  const refresh = useCallback(() => {
    void read('')
    for (const path of opened.current) void read(path)
  }, [read])

  useEffect(() => {
    refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    // A burst of changes, such as a file arriving with others, is read once.
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 150)
    }
    const stop = client.session.onEvent((event) => {
      if (event.name === 'workspace.changed') soon()
    })
    window.addEventListener('focus', soon)
    return () => {
      clearTimeout(timer)
      stop()
      window.removeEventListener('focus', soon)
    }
  }, [client, refresh])

  const rows = useMemo(() => visibleRows(listings, open), [listings, open])
  const root = listings.get('')
  const chosen = rows.find((row) => row.entry.path === selected)?.entry

  // What was selected and is gone, or inside a folder now shut, gives way to what is still there.
  useEffect(() => {
    if (selected !== undefined && root?.is === 'listed' && !rows.some((row) => row.entry.path === selected)) setSelected(undefined)
  }, [rows, selected, root])

  const toggle = (path: string) => {
    const next = new Set(open)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      if (listings.get(path)?.is !== 'listed') {
        setListings((known) => new Map(known).set(path, { is: 'reading' }))
        void read(path)
      }
    }
    setOpen(next)
  }

  const openFile = (entry: WorkspaceEntry) => {
    if (entry.kind === 'folder') return toggle(entry.path)
    if (!runsWhenOpened(entry.name)) void files?.open?.(entry.location)
  }

  if (root === undefined || root.is === 'reading')
    return (
      <Panel>
        <Skeleton />
      </Panel>
    )
  if (root.is === 'failed')
    return (
      <Panel>
        <Empty title="The folder could not be read" detail={root.problem}>
          <Button size="sm" onClick={refresh}>
            Try again
          </Button>
        </Empty>
      </Panel>
    )

  const location = root.folder.location
  const toolbar = (
    <div className="flex min-w-0 items-center justify-between gap-4">
      <span dir="rtl" title={location} className="min-w-0 truncate text-left font-mono text-[0.6875rem] text-text-faint">
        <bdi>{location}</bdi>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Refresh" onClick={refresh}>
          <RefreshGlyph />
        </IconButton>
        {files?.open && (
          <Button size="sm" onClick={() => void files.open?.(location)}>
            Open the folder
          </Button>
        )}
      </div>
    </div>
  )

  if (root.entries.length === 0)
    return (
      <div className="grid gap-3">
        {toolbar}
        <Panel>
          <Empty
            title="Nothing here yet"
            detail={`What you hand ${productName} with what you say goes to its inbox here, and the files it writes for you appear beside it.`}
          />
        </Panel>
      </div>
    )

  return (
    <div className="grid gap-3">
      {toolbar}
      <Panel className="grid grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)]">
        <Tree rows={rows} selected={selected} onSelect={setSelected} onToggle={toggle} onOpen={openFile} />
        <section aria-label="Preview" className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
          {chosen ? (
            <Preview client={client} entry={chosen} onOpenFolder={() => toggle(chosen.path)} />
          ) : (
            <div className="row-span-2 flex items-center justify-center px-8 text-center">
              <span className="grid gap-1.5">
                <span className="text-sm text-text-soft">Select a file to see it here</span>
                <span className="text-text-faint text-xs">Arrow keys move through the list; Enter opens what is selected.</span>
              </span>
            </div>
          )}
        </section>
      </Panel>
    </div>
  )
}

/** The pane that holds the browser, as tall as the screen allows. */
function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('h-[max(24rem,calc(100vh-19rem))] overflow-hidden rounded-lg bg-raised/95 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]', className)}>
      {children}
    </div>
  )
}

interface TreeProps {
  rows: readonly Row[]
  selected: string | undefined
  onSelect(path: string | undefined): void
  onToggle(path: string): void
  onOpen(entry: WorkspaceEntry): void
}

/** The folder's contents as a list whose folders fold open, moved through with the keys. */
function Tree({ rows, selected, onSelect, onToggle, onOpen }: TreeProps) {
  const list = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  // The row selected stays in view as the keys move through a long list.
  useEffect(() => {
    if (selected === undefined) return
    list.current?.querySelector(`[data-path="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const move = moveFor(event.key, rows, selected)
    if (!move) return
    event.preventDefault()
    if ('to' in move) onSelect(move.to)
    else if ('toggle' in move) onToggle(move.toggle)
    else {
      const row = rows.find((one) => one.entry.path === move.open)
      if (row) onOpen(row.entry)
    }
  }

  return (
    <div
      ref={list}
      role="tree"
      aria-label="Files"
      // The tree takes the keyboard as one control, as a file manager's list does, and says which row is selected.
      tabIndex={0}
      aria-activedescendant={selected === undefined ? undefined : rowId(rows.findIndex((row) => row.entry.path === selected))}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="scroll-quiet min-h-0 overflow-y-auto border-black/45 border-r py-1.5 shadow-[1px_0_0_rgb(255_255_255/0.035)] outline-none"
    >
      {rows.map((row, index) => {
        const { entry, depth } = row
        const on = entry.path === selected
        const folder = entry.kind === 'folder'
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the tree takes the keys for all its rows
          <div
            key={entry.path}
            id={rowId(index)}
            data-path={entry.path}
            tabIndex={-1}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={on}
            aria-expanded={folder ? row.open : undefined}
            onClick={() => onSelect(entry.path)}
            onDoubleClick={() => onOpen(entry)}
            className={cn(
              'mx-1.5 flex h-7 cursor-default select-none items-center gap-1.5 rounded-md pr-2 text-[0.8125rem]',
              on ? (focused ? 'bg-accent/20 text-text' : 'bg-white/[0.08] text-text') : 'text-text-soft hover:bg-white/[0.03]'
            )}
            style={{ paddingLeft: 4 + depth * 14 }}
          >
            {folder ? (
              <button
                type="button"
                tabIndex={-1}
                aria-label={row.open ? `Close ${entry.name}` : `Open ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggle(entry.path)
                }}
                className="flex size-4 shrink-0 items-center justify-center text-text-faint [&_svg]:size-3"
              >
                <span className={cn('transition-transform duration-(--duration-quick) ease-soft', row.open && 'rotate-90')}>
                  <DisclosureGlyph />
                </span>
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className={cn('shrink-0 [&_svg]:size-3.5', on && focused ? 'text-accent' : 'text-text-faint')}>
              {folder ? <FolderGlyph /> : <FileGlyph />}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <span className="shrink-0 text-[0.6875rem] text-text-faint tabular-nums">{row.reading ? '…' : folder ? entry.size : sizeWords(entry.size)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** The identifier of a row of the tree, for the tree to say which is selected. */
const rowId = (index: number) => `files-row-${index}`

/** The one selected, whole: what it is, what can be done with it, and what is in it. */
function Preview({ client, entry, onOpenFolder }: { client: Client; entry: WorkspaceEntry; onOpenFolder(): void }) {
  const { host } = useDevice()
  const files = host?.files
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timer)
  }, [copied])
  // Its versions in place of its content, for the file chosen: another file opens on its content.
  const [versions, setVersions] = useState<string>()
  const showingVersions = versions === entry.path

  const folder = entry.kind === 'folder'
  const facts = [folder ? itemsWords(entry.size) : `${kindOf(entry.name).label} · ${sizeWords(entry.size)}`, modifiedWords(entry.modified)].filter(Boolean)
  const opens = files?.open && (folder || !runsWhenOpened(entry.name))

  return (
    <>
      <header className="flex h-14 min-w-0 items-center gap-3 border-line border-b pr-2 pl-4">
        {folder ? (
          <span className="flex h-6 w-7 shrink-0 items-center justify-center text-text-faint">
            <FolderGlyph />
          </span>
        ) : (
          <FileMark name={entry.name} />
        )}
        <div className="grid min-w-0 flex-1">
          <span className="truncate font-medium text-[0.8125rem]">{entry.name}</span>
          <span className="truncate text-[0.6875rem] text-text-faint">{facts.join(' · ')}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {opens && (
            <Button size="sm" kind="quiet" className="[&_svg]:size-3.5" onClick={() => void files?.open?.(entry.location)}>
              <OpenGlyph />
              Open
            </Button>
          )}
          {files && (
            <IconButton label="Show in folder" onClick={() => void files.reveal(entry.location)}>
              <RevealGlyph />
            </IconButton>
          )}
          <IconButton label={copied ? 'Copied' : 'Copy path'} onClick={() => void copyText(entry.location).then(setCopied)}>
            {copied ? <CheckGlyph /> : <CopyGlyph />}
          </IconButton>
          {!folder && (
            <IconButton label="Save a copy" onClick={() => void saveCopy(client, entry.path, entry.name).catch(() => undefined)}>
              <DownloadGlyph />
            </IconButton>
          )}
          {!folder && (
            <IconButton
              label={showingVersions ? 'Show the file' : 'Versions'}
              active={showingVersions}
              onClick={() => setVersions(showingVersions ? undefined : entry.path)}
            >
              <VersionsGlyph />
            </IconButton>
          )}
        </div>
      </header>
      {folder ? (
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <span className="text-text-faint [&_svg]:size-14">
            <FolderGlyph />
          </span>
          <span className="text-sm text-text-soft">{itemsWords(entry.size)}</span>
          <Button size="sm" kind="quiet" onClick={onOpenFolder}>
            Show what is in it
          </Button>
        </div>
      ) : showingVersions ? (
        <Versions client={client} location={entry.location} modified={entry.modified} />
      ) : (
        <FileContent client={client} path={entry.path} name={entry.name} size={entry.size} modified={entry.modified} className="h-full" />
      )}
    </>
  )
}

function Empty({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
      <span className="text-text-faint [&_svg]:size-10">
        <FolderGlyph />
      </span>
      <span className="grid max-w-sm gap-1.5">
        <span className="text-sm text-text-soft">{title}</span>
        {detail && <span className="text-text-faint text-xs leading-relaxed">{detail}</span>}
      </span>
      {children}
    </div>
  )
}

/** Rows standing in for the list while it is read. */
function Skeleton() {
  return (
    <div className="grid h-full grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)]" role="status" aria-label="Reading the folder">
      <div className="grid content-start gap-2.5 border-black/45 border-r px-4 py-3.5 shadow-[1px_0_0_rgb(255_255_255/0.035)]">
        {[62, 48, 74, 40, 56].map((width) => (
          <span key={width} className="h-2.5 rounded-xs bg-white/[0.05]" style={{ width: `${width}%` }} />
        ))}
      </div>
      <div />
    </div>
  )
}
