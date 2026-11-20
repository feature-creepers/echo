import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { HarnessState, Settings } from '@repo/protocol'
import { useState } from 'react'
import { standing, TONES, useLookAgain } from '../conversation/engine-rows.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Select } from '../primitives/select.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'

/** The value of the preference that lets the first ready harness answer. */
const FIRST_READY = '*'

/**
 * The AI programs the assistant runs on, signed in with the person's own accounts: which one it uses, and the
 * model each answers with. These follow the person: the core keeps them, not this computer.
 */
export function ModelsSection({ client, settings }: { client: Client; settings: Settings }) {
  const known = useFollowed(client.engines)
  const [problem, setProblem] = useState<string>()
  const { looking, look } = useLookAgain(client.engines)

  const run = (work: Promise<unknown>) => {
    setProblem(undefined)
    work.catch(() => setProblem('The choice could not be saved.'))
  }

  if (!known) return <p className="text-text-faint text-xs">Looking for the AI programs on this machine…</p>
  const installed = known.harnesses.filter((harness) => harness.installed)

  return (
    <div className="grid gap-10">
      <section aria-label="AI programs" className="grid gap-2">
        <Eyebrow className="px-0.5 font-semibold text-text-soft">AI programs</Eyebrow>
        <div className="grid gap-3">
          {known.harnesses.map((harness) => (
            <HarnessCard
              key={harness.id}
              harness={harness}
              inUse={harness.id === known.active}
              onSignIn={() => run(client.engines.signIn(harness.id))}
              onModel={(model) => run(client.session.run('engines.model.set', { harness: harness.id, model }))}
              onEffort={(effort) => run(client.session.run('engines.effort.set', { harness: harness.id, effort }))}
            />
          ))}
        </div>
      </section>

      {installed.length > 1 && (
        <SettingGroup title="When more than one is ready">
          <SettingRow title="Answer with" detail="The others are used only when this one is not ready: not signed in, or not installed.">
            <Select
              label="Answer with"
              className="w-52"
              value={settings.engines.preferred ?? FIRST_READY}
              options={[
                { value: FIRST_READY, label: 'The first ready', description: 'In the order they are listed here' },
                ...installed.map((harness) => {
                  const { tone, text } = standing(harness)
                  return { value: harness.id, label: harness.name, hint: tone === 'ok' ? undefined : text }
                })
              ]}
              onChange={(value) => run(client.session.run('engines.prefer', { harness: value === FIRST_READY ? null : value }))}
            />
          </SettingRow>
        </SettingGroup>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button kind="quiet" size="sm" disabled={looking} onClick={look}>
          {looking ? 'Looking…' : 'Check again'}
        </Button>
        {problem ? (
          <span role="alert" className="text-danger text-xs">
            {problem}
          </span>
        ) : known.active === undefined ? (
          <span className="text-text-soft text-xs">Install Claude Code or Codex and sign in with your own account.</span>
        ) : (
          <span className="text-text-faint text-xs">A change applies from your next question.</span>
        )}
      </div>
    </div>
  )
}

interface HarnessCardProps {
  harness: HarnessState
  inUse: boolean
  onSignIn(): void
  onModel(model: string): void
  onEffort(effort: string | null): void
}

/** The value of the level of reasoning that lets the program decide. */
const AUTOMATIC = '*'

/** One AI program: where it stands, the model it answers with, picked from those it offers, and how hard it reasons. */
function HarnessCard({ harness, inUse, onSignIn, onModel, onEffort }: HarnessCardProps) {
  const { tone, text } = standing(harness)
  const choosable = harness.installed && harness.models.length > 0
  const chosen = harness.models.find((model) => model.id === harness.model)
  const efforts = chosen?.efforts ?? []
  const effort = efforts.find((one) => one.id === harness.effort)

  return (
    <section
      aria-label={harness.name}
      className={cn(
        'divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-raised/95 transition-shadow duration-(--duration-calm)',
        inUse ? 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.11)]' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]'
      )}
    >
      <div className="flex items-center gap-3.5 px-4 py-3">
        <span className={cn('size-2 shrink-0 rounded-full', TONES[tone])} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2.5 font-medium text-[0.8125rem]">
            {harness.name}
            {inUse && <Eyebrow accent>In use</Eyebrow>}
          </span>
          <span className="truncate text-text-faint text-xs" title={text}>
            {text}
            {harness.version && tone === 'ok' ? ` · ${harness.version}` : ''}
          </span>
        </div>
        {harness.installed && !harness.signedIn && (
          <Button size="sm" onClick={onSignIn}>
            Sign in
          </Button>
        )}
      </div>

      {choosable && (
        <SettingRow title="Model" detail={chosen?.description}>
          <Select
            label={`The model ${harness.name} answers with`}
            className="w-52"
            value={harness.model ?? ''}
            options={harness.models.map((model) => ({
              value: model.id,
              label: model.name,
              description: model.description,
              hint: model.id === harness.defaultModel ? 'Default' : undefined
            }))}
            onChange={onModel}
          />
        </SettingRow>
      )}

      {choosable && efforts.length > 0 && (
        <SettingRow title="Reasoning" detail={effort?.description ?? `${harness.name} decides how hard ${chosen?.name ?? 'it'} thinks.`}>
          <Select
            label={`How hard ${harness.name} reasons`}
            className="w-52"
            value={harness.effort ?? AUTOMATIC}
            options={[
              ...efforts.map((one) => ({
                value: one.id,
                label: one.name,
                description: one.description,
                hint: one.id === chosen?.defaultEffort ? 'Default' : undefined
              })),
              ...(chosen?.defaultEffort === undefined ? [{ value: AUTOMATIC, label: 'Automatic', description: `${harness.name} decides` }] : [])
            ]}
            onChange={(value) => onEffort(value === AUTOMATIC ? null : value)}
          />
        </SettingRow>
      )}
    </section>
  )
}
