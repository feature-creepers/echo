import type { Client } from '@repo/client'
import type { ActivityCheck } from '@repo/protocol'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { checkInWords } from './words.ts'

/** Hand the person a file, as a download from this window. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has its own copy once started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const TONE = { ok: 'text-ok', danger: 'text-danger', soft: 'text-text-faint' } as const

type Checked = { state: 'idle' } | { state: 'checking' } | { state: 'done'; check: ActivityCheck } | { state: 'failed'; message: string }

/**
 * The signed log (docs/SPEC.md, section 12.2): whether any record of the activity was changed, taken out or erased
 * before its time, checked when the person asks, and the whole log, sealed, saved as a file to hold it to later.
 */
export function ChainCheck({ client }: { client: Client }) {
  const [checked, setChecked] = useState<Checked>({ state: 'idle' })
  const [saving, setSaving] = useState(false)

  const check = () => {
    setChecked({ state: 'checking' })
    client.session.run('activity.check', {}).then(
      (result) => setChecked({ state: 'done', check: result }),
      () => setChecked({ state: 'failed', message: 'The log could not be checked.' })
    )
  }
  const save = () => {
    setSaving(true)
    client.session
      .run('activity.export', {})
      .then(
        ({ name, text }) => download(name, text),
        () => setChecked({ state: 'failed', message: 'The log could not be exported.' })
      )
      .finally(() => setSaving(false))
  }

  const said =
    checked.state === 'done'
      ? checkInWords(checked.check, new Date())
      : checked.state === 'failed'
        ? { text: checked.message, tone: 'danger' as const }
        : checked.state === 'checking'
          ? { text: 'Checking every record…', tone: 'soft' as const }
          : undefined

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button kind="quiet" size="sm" disabled={checked.state === 'checking'} onClick={check}>
        Check the log
      </Button>
      <Button kind="quiet" size="sm" disabled={saving} onClick={save}>
        {saving ? 'Exporting…' : 'Export'}
      </Button>
      {said && (
        <span role="status" className={cn('text-xs', TONE[said.tone])}>
          {said.text}
        </span>
      )}
    </div>
  )
}
