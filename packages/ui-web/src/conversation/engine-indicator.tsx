import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { useState } from 'react'
import { BAR_LABEL } from '../access/access-indicator.tsx'
import { cn } from '../primitives/cn.ts'
import { Menu, type MenuEntry } from '../primitives/menu.tsx'
import { standing, TONES } from './engine-rows.tsx'

/**
 * Which AI program answers, with which model and how hard it reasons, under the composer, with a dot that says
 * whether it is ready. Pressed, it opens a menu right there to change them, the same choices as the Models
 * settings, which its last entry opens. Picking a program or a model keeps the menu open, so what depends on it
 * can be picked next.
 */
export function EngineIndicator({ client, onOpenSettings }: { client: Client; onOpenSettings(): void }) {
  const engines = useFollowed(client.engines)
  const [failed, setFailed] = useState(false)
  const active = engines?.harnesses.find((harness) => harness.id === engines.active)
  const model = active?.models.find((one) => one.id === active.model)
  const effort = model?.efforts?.find((one) => one.id === active?.effort)

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
            // A model with levels of reasoning keeps the menu open, so its level can be picked next.
            stay: (one.efforts?.length ?? 0) > 0,
            onSelect: () => {
              if (one.id !== active.model) run(client.session.run('engines.model.set', { harness: active.id, model: one.id }))
            }
          }))
        ]
      : []
  const efforts: MenuEntry[] =
    active && model?.efforts && model.efforts.length > 0
      ? [
          { divider: true },
          { heading: 'Reasoning' },
          ...model.efforts.map((one) => ({
            label: one.name,
            detail: one.description,
            hint: one.id === model.defaultEffort ? 'Default' : undefined,
            checked: one.id === active.effort,
            onSelect: () => {
              if (one.id !== active.effort) run(client.session.run('engines.effort.set', { harness: active.id, effort: one.id }))
            }
          })),
          // Without a default the harness names, the program picks the level itself until one is chosen.
          ...(model.defaultEffort === undefined
            ? [
                {
                  label: 'Automatic',
                  detail: `${active.name} decides.`,
                  checked: active.effort === undefined,
                  onSelect: () => {
                    if (active.effort !== undefined) run(client.session.run('engines.effort.set', { harness: active.id, effort: null }))
                  }
                }
              ]
            : [])
        ]
      : []

  return (
    <Menu
      side="top"
      align="end"
      label="The AI program, its model and how hard it reasons"
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
          {failed ? (
            <span className="text-danger">· not changed</span>
          ) : (
            model && (
              <span className="text-text-faint/80">
                · {model.name}
                {effort && ` · ${effort.name}`}
              </span>
            )
          )}
        </button>
      )}
      items={[{ heading: 'AI program' }, ...programs, ...models, ...efforts, { divider: true }, { label: 'Models settings…', onSelect: onOpenSettings }]}
    />
  )
}
