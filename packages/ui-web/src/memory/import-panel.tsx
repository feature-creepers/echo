import type { MemoryState } from '@repo/client'
import type { MemoryImport } from '@repo/protocol'
import { useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { importDetail } from './words.ts'

/**
 * What the proof of concept knew, brought in once (docs/SPEC.md, section 10.7): its notes, the context file the person
 * filled in and its history, from the folder picked with the system's own picker. Choosing it is the consent to read
 * it; nothing there changes, and the assistant is not given the folder.
 */
export function ImportPanel({ memory, imported }: { memory: MemoryState; imported: MemoryImport | undefined }) {
  const { host } = useDevice()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  const bringIn = async () => {
    const [folder] = (await host?.files?.pick('folder', 'import').catch(() => [])) ?? []
    if (folder === undefined) return
    setBusy(true)
    setProblem(undefined)
    try {
      await memory.importEarlier(folder)
    } catch (error) {
      setProblem(error instanceof Error && error.message !== '' ? error.message : 'It could not be brought in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3 border border-line-strong bg-raised/95 p-5">
      <div className="flex items-center justify-between gap-6">
        <div className="grid min-w-0 gap-1">
          <Eyebrow>What the proof of concept knew</Eyebrow>
          <p className="text-sm text-text-soft leading-relaxed">{busy ? 'Bringing it in…' : importDetail(imported)}</p>
        </div>
        {host?.files ? (
          <Button kind="secondary" size="sm" className="shrink-0" onClick={() => void bringIn()} disabled={busy}>
            {imported ? 'Import again…' : 'Import…'}
          </Button>
        ) : (
          <span className="shrink-0 text-text-faint text-xs">From the desktop app</span>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-danger text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </div>
  )
}
