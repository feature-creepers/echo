import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { UTTERANCE_MAX_LENGTH } from '@repo/protocol'
import { type KeyboardEvent, useId, useMemo, useState } from 'react'
import { lastPart } from '../changes/words.ts'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { TEXT_AREA } from '../settings/field.ts'
import { BackLink } from './back-link.tsx'
import { projectFolders } from './project-folders.ts'

interface ProjectFormProps {
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
      <div className="grid grid-cols-1 gap-2 border-line border-b px-4 pt-2 pb-3">
        <BackLink onClick={onBack}>Threads</BackLink>
        <div className="grid gap-1">
          <span className="display text-[1.75rem] leading-[1.5rem]">Open a project</span>
          <span className="text-[0.8125rem] text-text-soft">Work together in a folder of yours: code, writing, accounts.</span>
        </div>
      </div>

      <div className="scroll-quiet grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div className="grid gap-2">
          <span id={ids.folders}>
            <Eyebrow>Folder</Eyebrow>
          </span>
          {folders.length > 0 && (
            <div role="radiogroup" aria-labelledby={ids.folders} className="grid border-text border-t-2">
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
                      '-outline-offset-1 flex min-w-0 items-center gap-3 border-line border-t px-1 py-2 text-left transition-colors duration-(--duration-quick) ease-soft first:border-t-0 hover:bg-text/[0.06]',
                      chosen ? 'text-text' : 'text-text-soft'
                    )}
                  >
                    <span aria-hidden="true" className={cn('size-3 shrink-0', chosen ? 'bg-text' : 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]')} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-[0.8125rem]">{lastPart(one.path)}</span>
                      <span dir="rtl" title={one.path} className="block truncate text-left font-mono text-[0.6875rem] text-text-soft">
                        <bdi>{one.path}</bdi>
                      </span>
                    </span>
                    {one.known && <span className="caps shrink-0 text-text-soft">Worked in</span>}
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
            folders.length === 0 && <p className="text-[0.8125rem] text-text-soft">Give a folder to change in Settings, Access, or ask for one by voice.</p>
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
            className={TEXT_AREA}
          />
        </div>

        <p className="text-[0.8125rem] text-text-soft leading-relaxed">
          {known
            ? 'Its thread there carries on, or a new one works beside it while it is busy.'
            : 'It may read and change files in this folder. Each change and command is decided by your approval level, and kept in Activity.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-line border-t px-4 py-3">
        <span role="alert" className="min-w-0 flex-1 text-[0.8125rem] text-danger">
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
