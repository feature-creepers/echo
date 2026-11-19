import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { UTTERANCE_MAX_LENGTH } from '@repo/protocol'
import { type KeyboardEvent, useId, useMemo, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { BackGlyph } from '../primitives/icons.tsx'
import { projectFolders } from './project-folders.ts'

export interface ProjectFormProps {
  client: Client
  /** The project's thread answers: the side sheet shows its work. */
  onOpened(thread: string): void
  onBack(): void
}

/**
 * A project opened from the interface rather than by voice (docs/SPEC.md, section 7.11): a folder, picked among
 * those already worked in or with the system's own picker, and what to do there first. Choosing the folder here
 * lets the assistant read and change it, as in Settings, Access; each use is still decided by the approval level.
 */
export function ProjectForm({ client, onOpened, onBack }: ProjectFormProps) {
  const { host } = useDevice()
  const threads = useFollowed(client.threads)
  const snapshot = useFollowed(client.settings)
  const places = snapshot.state === 'ready' ? snapshot.settings.access.places : []
  const offered = useMemo(() => projectFolders(threads.threads, places), [threads.threads, places])
  /** A folder picked with the system's picker that is not among those offered. */
  const [picked, setPicked] = useState<string>()
  /** The folder chosen; until one is, the first offered, once the threads and settings have arrived. */
  const [chosenFolder, setFolder] = useState<string>()
  const [request, setRequest] = useState('')
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const ids = { folders: useId(), request: useId() }
  const folders = picked && !offered.some((one) => one.path === picked) ? [{ path: picked, known: false }, ...offered] : offered
  const folder = chosenFolder ?? folders[0]?.path
  const known = folders.find((one) => one.path === folder)?.known === true

  const pick = async () => {
    const [chosen] = (await host?.files?.pick('folder', 'project').catch(() => [])) ?? []
    if (chosen === undefined) return
    setPicked(chosen)
    setFolder(chosen)
    setProblem(undefined)
  }

  const start = async () => {
    setProblem(undefined)
    if (folder === undefined) return setProblem('Choose the folder to work in.')
    if (request.trim() === '') return setProblem('Say what to do there first.')
    setBusy(true)
    try {
      const opened = await client.threads.open({ folder, request: request.trim() })
      onOpened(opened.thread)
    } catch (error) {
      setProblem(error instanceof Error && error.message !== '' ? error.message : 'The project could not be opened.')
      setBusy(false)
    }
  }

  // Escape goes back to the threads, and no further; Ctrl or Command with Enter starts, as a form is sent.
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onBack()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !busy) {
      event.preventDefault()
      void start()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape and Ctrl+Enter anywhere in the form, as in a dialog
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={keys}>
      <div className="grid grid-cols-1 gap-2 border-line border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex w-fit items-center gap-1 rounded-sm px-1 py-0.5 text-text-faint text-xs transition-colors hover:text-text"
        >
          <BackGlyph /> Threads
        </button>
        <div className="grid gap-0.5">
          <span className="font-medium text-[0.9375rem] leading-snug">Open a project</span>
          <span className="text-text-faint text-xs">Work together in a folder of yours: code, writing, accounts.</span>
        </div>
      </div>

      <div className="scroll-quiet grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div className="grid gap-2">
          <span id={ids.folders}>
            <Eyebrow>Folder</Eyebrow>
          </span>
          {folders.length > 0 && (
            <div role="radiogroup" aria-labelledby={ids.folders} className="grid gap-px">
              {folders.map((one) => {
                const chosen = one.path === folder
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a row with the folder's name and path reads better than a radio button, and says the same
                  <button
                    key={one.path}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    onClick={() => setFolder(one.path)}
                    className={cn(
                      'flex min-w-0 items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-(--duration-quick) ease-soft',
                      chosen ? 'bg-white/[0.09] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]' : 'hover:bg-raised'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 shrink-0 rounded-full', chosen ? 'bg-accent' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)]')}
                    />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm">{lastPart(one.path)}</span>
                      <span dir="rtl" title={one.path} className="block truncate text-left font-mono text-[0.6875rem] text-text-faint">
                        <bdi>{one.path}</bdi>
                      </span>
                    </span>
                    {one.known && <span className="shrink-0 text-label text-text-faint">Worked in</span>}
                  </button>
                )
              })}
            </div>
          )}
          {host?.files ? (
            <Button kind="secondary" size="sm" className="w-fit" onClick={() => void pick()} disabled={busy}>
              Choose a folder…
            </Button>
          ) : (
            folders.length === 0 && <p className="text-text-faint text-xs">Give a folder to change in Settings, Access, or ask for one by voice.</p>
          )}
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={ids.request}>
            <Eyebrow>What to do first</Eyebrow>
          </label>
          <textarea
            id={ids.request}
            value={request}
            rows={4}
            maxLength={UTTERANCE_MAX_LENGTH}
            placeholder="Fix the failing test, then run the checks."
            onChange={(event) => setRequest(event.target.value)}
            className="w-full resize-none rounded-md border border-line-strong bg-black/25 px-3 py-2 text-[0.8125rem] text-text leading-relaxed shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] transition duration-(--duration-quick) ease-soft placeholder:text-text-faint"
          />
        </div>

        <p className="text-text-faint text-xs leading-relaxed">
          {known
            ? 'Its thread there carries on, or a new one works beside it while it is busy.'
            : 'It may read and change files in this folder. Each change and command is decided by your approval level, and kept in Activity.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-line border-t px-4 py-3">
        <span role="alert" className="min-w-0 flex-1 text-danger text-xs">
          {problem}
        </span>
        <Button kind="quiet" size="sm" onClick={onBack} disabled={busy}>
          Cancel
        </Button>
        <Button kind="primary" size="sm" onClick={() => void start()} disabled={busy || folder === undefined || request.trim() === ''}>
          {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </div>
  )
}
