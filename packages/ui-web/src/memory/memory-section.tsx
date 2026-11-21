import { FACT_KIND_TITLES, type MemoryState, memoryMarkdown } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { EmptyPlane, SettingGroup } from '../settings/rows.tsx'
import { FactRow } from './fact-row.tsx'
import { ImportPanel } from './import-panel.tsx'
import { MeaningPanel } from './meaning-panel.tsx'
import { RetentionPanel } from './retention-panel.tsx'
import { SleepPanel } from './sleep-panel.tsx'

const TITLE = 'What I know about you'

/** Hand the person a file, as a download from this window. */
function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has its own copy once started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The memory, as the person sees and corrects it (docs/SPEC.md, section 10.7): when the assistant sleeps and
 * what it is doing asleep, the portrait it keeps of the person, and every fact by kind, each with where it was
 * learned, to edit or forget. The whole of it exports to Markdown.
 */
export function MemorySection({ memory, productName }: { memory: MemoryState; productName: string }) {
  const view = useFollowed(memory)
  if (!view) return <p className="caps text-text-faint">Reading what it remembers…</p>

  const count = view.groups.reduce((sum, group) => sum + group.facts.length, 0)
  const exportFile = () => {
    const now = new Date()
    const name = `${productName.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}-memory-${now.toISOString().slice(0, 10)}.md`
    download(name, memoryMarkdown(view, { title: TITLE, now }))
  }

  return (
    <div className="grid gap-10">
      <SettingGroup title="Sleep and keeping">
        <SleepPanel memory={memory} sleep={view.sleep} />
        <RetentionPanel memory={memory} days={view.retentionDays} />
        {view.meaning && <MeaningPanel memory={memory} meaning={view.meaning} />}
        <ImportPanel memory={memory} imported={view.imported} />
      </SettingGroup>

      {view.profile && (
        <section className="grid gap-3" aria-label="Portrait">
          <Eyebrow>Portrait · read before every conversation</Eyebrow>
          <p className="max-w-2xl border-text border-l-2 pl-4 text-[0.8125rem] text-text-soft leading-relaxed">{view.profile}</p>
        </section>
      )}

      <section className="grid gap-6" aria-label={TITLE}>
        <div className="flex items-end justify-between gap-4">
          <div className="grid gap-1.5">
            <h2 className="display text-[1.75rem] leading-6">{TITLE}</h2>
            <p className="caps text-text-soft">{count === 0 ? 'Nothing yet' : `${count} ${count === 1 ? 'fact' : 'facts'}`}</p>
          </div>
          <Button kind="quiet" size="sm" onClick={exportFile}>
            Export to Markdown
          </Button>
        </div>

        {count === 0 ? (
          <EmptyPlane>
            <p>Every word said is kept and can be searched at once. While it sleeps, {productName} picks out what is worth remembering about you.</p>
            <p className="text-text-faint">Or say “remember that…”, and it is kept straight away.</p>
          </EmptyPlane>
        ) : (
          view.groups.map((group) => (
            <section key={group.kind} className="grid gap-2" aria-label={FACT_KIND_TITLES[group.kind]}>
              <div className="flex items-baseline justify-between gap-2">
                <Eyebrow>{FACT_KIND_TITLES[group.kind]}</Eyebrow>
                <span className="caps text-text-faint">{group.facts.length}</span>
              </div>
              <ul className="divide-y divide-line border-text border-t-2">
                {group.facts.map((fact) => (
                  <FactRow key={fact.id} fact={fact} onEdit={(text, kind) => memory.edit(fact.id, text, kind)} onForget={() => memory.forget(fact.id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </section>
    </div>
  )
}
