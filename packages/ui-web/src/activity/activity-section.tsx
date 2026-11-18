import type { Client } from '@repo/client'
import type { AccessUse } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Changes } from '../changes/changes.tsx'
import { Counts, type Relative } from '../changes/diff-view.tsx'
import { type Undo, UndoAction } from '../changes/undo-action.tsx'
import { useAssistantFolder } from '../changes/use-assistant-folder.ts'
import { relativePath, totalOf } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { Choice } from '../primitives/choice.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { settle } from '../styles/motion.ts'
import { ChainCheck } from './chain-check.tsx'
import { useActivity } from './use-activity.ts'
import { dayOf, decisionInWords, FILTER_LABELS, FILTERS, type Filter, shownUnder, summary, timeOf } from './words.ts'

const TONE_DOT = { ok: 'bg-ok', accent: 'bg-accent', danger: 'bg-danger', soft: 'bg-text-faint' } as const

/** A path shown in full when it fits, and by its end when it does not: the end says which file it is. */
function PathText({ path }: { path: string }) {
  return (
    <span dir="rtl" title={path} className="block truncate text-left font-mono text-text-soft text-xs">
      <bdi>{path}</bdi>
    </span>
  )
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={cn('transition-transform duration-(--duration-quick) ease-soft', open && 'rotate-90')}
  >
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
)

/**
 * What the assistant did on this computer (docs/SPEC.md, section 12.2): every file it read or changed and every
 * command it ran, the latest first, with what was decided and how it went. A row opens to the whole of it, and
 * to putting a changed file back or moving a created one to the trash. Commands cannot be undone.
 */
export function ActivitySection({ client, productName }: { client: Client; productName: string }) {
  const activity = useActivity(client)
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string>()
  const [loading, setLoading] = useState(false)
  const assistantFolder = useAssistantFolder(client)
  // A path is shown from the folder of the thread that used it when it is a project's, else from the assistant's.
  const relativeFor = useCallback(
    (use: AccessUse): Relative =>
      (path) =>
        relativePath(path, [client.threads.current().threads.find((thread) => thread.id === use.thread)?.folder, assistantFolder]),
    [client, assistantFolder]
  )

  const shown = useMemo(() => (activity.uses ?? []).filter((use) => shownUnder(use, filter)), [activity.uses, filter])
  const days = useMemo(() => {
    const now = new Date()
    const grouped: { day: string; uses: AccessUse[] }[] = []
    for (const use of shown) {
      const day = dayOf(use.at, now)
      const last = grouped.at(-1)
      if (last?.day === day) last.uses.push(use)
      else grouped.push({ day, uses: [use] })
    }
    return grouped
  }, [shown])

  if (activity.problem) return <p className="text-danger text-xs">{activity.problem}</p>
  if (!activity.uses) return <p className="text-text-faint text-xs">Reading the activity…</p>

  if (activity.uses.length === 0) {
    return (
      <div className="grid gap-2 rounded-lg border border-line-strong border-dashed px-6 py-10 text-center">
        <p className="text-sm text-text-soft leading-relaxed">Nothing yet. Every file {productName} reads or changes, and every command it runs, shows here.</p>
        <p className="text-text-faint text-xs">Kept 30 days. A file it changed can be put back from here.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Choice<Filter> label="Show" value={filter} options={FILTERS.map((value) => ({ value, label: FILTER_LABELS[value] }))} onChange={setFilter} />
        <span className="text-text-faint text-xs">Kept 30 days · commands cannot be undone</span>
      </div>

      <ChainCheck client={client} />

      {days.length === 0 ? (
        <div className="grid gap-1 rounded-lg border border-line-strong border-dashed px-6 py-8 text-center">
          <p className="text-sm text-text-soft">Nothing {FILTER_LABELS[filter].toLowerCase()} here.</p>
          <p className="text-text-faint text-xs">{filter === 'refused' ? 'Everything it tried was within what you gave.' : 'Try another filter.'}</p>
        </div>
      ) : (
        days.map(({ day, uses }) => (
          <section key={day} aria-label={day} className="grid gap-2">
            <Eyebrow className="px-0.5 font-semibold text-text-soft">{day}</Eyebrow>
            <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-raised/95 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
              {uses.map((use) => (
                <UseRow
                  key={use.id}
                  use={use}
                  open={open === use.id}
                  onToggle={() => setOpen(open === use.id ? undefined : use.id)}
                  undo={activity.undo}
                  client={client}
                  relative={relativeFor(use)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {activity.more && (
        <div className="flex justify-center">
          <Button
            kind="quiet"
            size="sm"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              void activity.earlier().finally(() => setLoading(false))
            }}
          >
            {loading ? 'Reading…' : 'Show earlier'}
          </Button>
        </div>
      )}
    </div>
  )
}

interface UseRowProps {
  use: AccessUse
  open: boolean
  onToggle(): void
  undo: Undo
  client: Client
  relative: Relative
}

function UseRow({ use, open, onToggle, undo, client, relative }: UseRowProps) {
  const said = summary(use)
  const decision = decisionInWords(use)
  const failed = use.outcome?.ok === false
  const changed = totalOf(use)
  const [showing, setShowing] = useState(false)

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-full grid-cols-[2.75rem_6.5rem_minmax(0,1fr)_auto_0.75rem] items-center gap-3 px-4 py-2.5 text-left transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.03]"
      >
        <span className="text-text-faint text-xs tabular-nums">{timeOf(use.at)}</span>
        <span className="flex items-center gap-2 text-xs">
          <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[decision.tone])} aria-hidden="true" />
          <span className={cn(decision.tone === 'danger' ? 'text-danger' : 'text-text-soft')}>{decision.word}</span>
        </span>
        <span
          className={cn('truncate', said.code ? 'font-mono text-[0.75rem]' : 'text-[0.8125rem]', use.decision === 'refused' && 'text-text-soft')}
          title={said.text}
        >
          {said.text}
        </span>
        <span className="flex items-center gap-2 text-text-faint text-xs">
          {changed && <Counts change={changed} className="text-[0.6875rem]" />}
          {use.destructive && <span className="text-danger/90">destructive</span>}
          {use.network && <span>network</span>}
          {failed && <span className="text-danger/90">failed</span>}
          {use.undo?.done && <span className="text-accent">undone</span>}
          <span className="hidden sm:inline">{decision.why}</span>
        </span>
        <span className="text-text-faint">
          <Chevron open={open} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={settle}
            className="grid min-w-0 grid-cols-1 gap-3 border-white/[0.06] border-t bg-black/[0.12] px-4 py-3.5 pl-[4.5rem]"
          >
            {use.command !== undefined && (
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-black/30 px-3 py-2 font-mono text-[0.75rem] text-text leading-relaxed shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
                {use.command}
              </pre>
            )}
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
              <Fact label={use.action === 'run' ? 'Ran in' : use.paths.length > 1 ? 'Files' : 'File'}>
                <span className="grid gap-0.5">
                  {use.paths.map((path) => (
                    <PathText key={path} path={path} />
                  ))}
                </span>
              </Fact>
              <Fact label="Decision">
                {decision.word}, {decision.why}
              </Fact>
              {use.detail && <Fact label="Told">{use.detail}</Fact>}
              {use.decision !== 'refused' && (
                <Fact label="Outcome">
                  {use.outcome === undefined ? (
                    <span className="text-text-faint">Not reported</span>
                  ) : use.outcome.ok ? (
                    'Done'
                  ) : (
                    <span className="text-danger">Failed{use.outcome.error ? `: ${use.outcome.error}` : ''}</span>
                  )}
                </Fact>
              )}
              <Fact label="Tool">
                <span className="font-mono">{use.tool}</span>
              </Fact>
            </dl>
            {showsChanges(use) && (
              <div className="grid min-w-0 grid-cols-1 gap-2">
                <div>
                  <Button kind="quiet" size="sm" className="-ml-2.5" aria-expanded={showing} onClick={() => setShowing(!showing)}>
                    {showing ? 'Hide the changes' : 'Show changes'}
                  </Button>
                </div>
                {showing && <Changes client={client} of={{ use: use.id }} relative={relative} version={use.undo?.done ?? ''} />}
              </div>
            )}
            {use.action === 'run' ? (
              use.decision !== 'refused' && <p className="text-text-faint text-xs">A command cannot be undone.</p>
            ) : (
              <UndoAction use={use} undo={undo} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

/** Whether a use made a change to files whose diff can be shown: allowed, done, and not a command. */
const showsChanges = (use: AccessUse) =>
  (use.action === 'create' || use.action === 'change' || use.action === 'delete') && use.decision !== 'refused' && use.outcome?.ok === true

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-faint">{label}</dt>
      <dd className="min-w-0 text-text-soft">{children}</dd>
    </>
  )
}
