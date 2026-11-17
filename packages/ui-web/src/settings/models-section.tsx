import type { Client } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { HarnessState, Settings } from '@repo/protocol'
import { useState } from 'react'
import { standing, TONES } from '../conversation/engine-rows.tsx'
import { Button } from '../primitives/button.tsx'
import { Choice } from '../primitives/choice.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { SettingGroup, SettingRow } from './rows.tsx'

/** The value of the preference that lets the first ready harness answer. */
const FIRST_READY = '*'

/**
 * The AI programs the assistant runs on, signed in with the user's own accounts: which one it uses, and the
 * model each answers with. These follow the user: the core keeps them, not this computer.
 */
export function ModelsSection({ client, settings }: { client: Client; settings: Settings }) {
  const known = useFollowed(client.engines)
  const [problem, setProblem] = useState<string>()
  const [checking, setChecking] = useState(false)

  const run = (work: Promise<unknown>) => {
    setProblem(undefined)
    work.catch(() => setProblem('The choice could not be saved.'))
  }
  const check = async () => {
    setChecking(true)
    try {
      await client.engines.refresh()
    } catch {
      // The rows keep what was last known.
    } finally {
      setChecking(false)
    }
  }

  if (!known) return <p className="font-mono text-text-faint text-xs">Looking for the AI programs on this machine…</p>
  const installed = known.harnesses.filter((harness) => harness.installed)

  return (
    <div className="grid gap-10">
      {known.harnesses.map((harness) => (
        <HarnessCard
          key={harness.id}
          harness={harness}
          inUse={harness.id === known.active}
          onSignIn={() => run(client.engines.signIn(harness.id))}
          onModel={(model) => run(client.session.run('engines.model.set', { harness: harness.id, model }))}
        />
      ))}

      {installed.length > 1 && (
        <SettingGroup title="When more than one is ready">
          <SettingRow title="Answer with" detail="The other is used only when this one is not ready: not signed in, or not installed." stacked>
            <Choice
              label="Answer with"
              value={settings.engines.preferred ?? FIRST_READY}
              options={[{ value: FIRST_READY, label: 'The first ready' }, ...installed.map((harness) => ({ value: harness.id, label: harness.name }))]}
              onChange={(value) => run(client.session.run('engines.prefer', { harness: value === FIRST_READY ? null : value }))}
            />
          </SettingRow>
        </SettingGroup>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button kind="quiet" size="sm" disabled={checking} onClick={() => void check()}>
          {checking ? 'Looking…' : 'Check again'}
        </Button>
        {problem ? (
          <span role="alert" className="text-danger text-xs">
            {problem}
          </span>
        ) : known.active === undefined ? (
          <span className="text-text-soft text-xs">Install Claude Code or Codex and sign in with your own account.</span>
        ) : (
          <span className="text-text-faint text-xs">A change applies from the next conversation.</span>
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
}

/** One AI program: where it stands, and the models it offers, one to pick. */
function HarnessCard({ harness, inUse, onSignIn, onModel }: HarnessCardProps) {
  const { tone, text } = standing(harness)
  const choosable = harness.installed && harness.models.length > 0

  return (
    <section
      aria-label={harness.name}
      className={cn('overflow-hidden rounded-lg border bg-surface/80 backdrop-blur-sm', inUse ? 'border-line-strong' : 'border-line')}
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <span className={cn('size-2 shrink-0 rounded-full', TONES[tone])} />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2.5 font-medium text-sm">
            {harness.name}
            {inUse && <Eyebrow accent>in use</Eyebrow>}
          </span>
          <span className="truncate text-text-soft text-xs" title={text}>
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
        <div className="border-line border-t px-5 pt-4 pb-5">
          <Eyebrow className="mb-3 block">Answers with</Eyebrow>
          <div role="radiogroup" aria-label={`The model ${harness.name} answers with`} className="grid gap-2">
            {harness.models.map((model) => {
              const chosen = model.id === harness.model
              return (
                // biome-ignore lint/a11y/useSemanticElements: a card per model, with its description, reads better than a bare radio button
                <button
                  key={model.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => {
                    if (!chosen) onModel(model.id)
                  }}
                  className={cn(
                    'flex items-center gap-4 rounded-md border px-4 py-3 text-left transition duration-150 ease-soft',
                    chosen ? 'border-accent/55 bg-accent/8 shadow-[0_0_24px_-12px_var(--accent)]' : 'border-line hover:border-line-strong hover:bg-raised/60'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border transition',
                      chosen ? 'border-accent' : 'border-line-strong'
                    )}
                  >
                    {chosen && <span className="size-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex items-center gap-2.5 text-sm">
                      <span className="font-medium">{model.name}</span>
                      {model.id === harness.defaultModel && <span className="font-mono text-label text-text-faint uppercase">default</span>}
                    </span>
                    <span className="text-text-soft text-xs leading-relaxed">{model.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
