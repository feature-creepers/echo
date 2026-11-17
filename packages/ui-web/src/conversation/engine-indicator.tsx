import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { useState } from 'react'
import { BAR_LABEL } from '../access/access-indicator.tsx'
import { cn } from '../primitives/cn.ts'
import { Menu, type MenuEntry } from '../primitives/menu.tsx'
import { standing, TONES } from './engine-rows.tsx'

/**
 * Which AI program answers, and with which model, under the composer, with a dot that says whether it is ready.
 * Pressed, it opens a menu right there to change both, the same choices as the Models settings, which its last
 * entry opens. Picking a program keeps the menu open, so its models can be picked next.
 */
export function EngineIndicator({ client, onOpenSettings }: { client: Client; onOpenSettings(): void }) {
  const engines = useFollowed(client.engines)
  const [failed, setFailed] = useState(false)
  const active = engines?.harnesses.find((harness) => harness.id === engines.active)
  const model = active?.models.find((one) => one.id === active.model)

  const run = (work: Promise<unknown>) => {
    setFailed(false)
    work.catch(() => setFailed(true))
  }

  const programs: MenuEntry[] =
    engines === undefined
      ? [{ label: 'Looking for them…', disabled: true, onSelect: () => undefined }]
      : engines.harnesses.map((harness) => {
          const { tone, text } = standing(harness)
          return {
            label: harness.name,
            mark: <span className={cn('size-1.5 rounded-full', TONES[tone])} />,
            checked: harness.id === engines.active,
            disabled: tone !== 'ok',
            hint: tone === 'ok' ? undefined : <span title={text}>{text}</span>,
            stay: true,
            onSelect: () => {
              if (harness.id !== engines.active) run(client.session.run('engines.prefer', { harness: harness.id }))
            }
          }
        })
  const models: MenuEntry[] =
    active && active.models.length > 0
      ? [
          { divider: true },
          { heading: 'Model' },
          ...active.models.map((one) => ({
            label: one.name,
            detail: one.description,
            hint: one.id === active.defaultModel ? 'Default' : undefined,
            checked: one.id === active.model,
            onSelect: () => {
              if (one.id !== active.model) run(client.session.run('engines.model.set', { harness: active.id, model: one.id }))
            }
          }))
        ]
      : []

  return (
    <Menu
      side="top"
      align="end"
      label="The AI program and its model"
      className="w-[18.5rem]"
      trigger={(_open, toggle, { props }) => (
        <button
          type="button"
          {...props}
          onClick={() => {
            setFailed(false)
            toggle()
          }}
          className={BAR_LABEL}
        >
          <span className={cn('size-1.5 rounded-full', engines === undefined ? 'bg-text-faint/50' : active ? 'bg-ok/80' : 'bg-warn')} />
          {engines === undefined ? 'Looking…' : active ? active.name : 'No AI program ready'}
          {failed ? <span className="text-danger">· not changed</span> : model && <span className="text-text-faint/80">· {model.name}</span>}
        </button>
      )}
      items={[{ heading: 'AI program' }, ...programs, ...models, { divider: true }, { label: 'Models settings…', onSelect: onOpenSettings }]}
    />
  )
}
