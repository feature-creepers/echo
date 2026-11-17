import { CommandFailed } from '@repo/client'
import { type CommandInput, PERSONA_NAME_MAX_LENGTH, type Persona, type PersonaId } from '@repo/protocol'
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { Orb } from '../presence/orb.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { TextField } from '../primitives/text-field.tsx'
import { accentStyle } from '../styles/accent.ts'
import { nameProblemCopy, refusalCopy, stanceCopy } from './copy.ts'
import { activeIn, choiceOf, NO_EDITS, nameIn, type PersonaDraft, problemsOf } from './draft.ts'

export interface PersonasFormProps {
  personas: readonly Persona[]
  /** The persona that answers now. */
  active: PersonaId
  /** What the button says, and what it says while the choice is on its way. */
  submitLabel: ReactNode
  busyLabel: string
  /** Said beside the button once the core has kept the choice. Left out, nothing is said. */
  doneLabel?: string
  /** Send the choice to the core. Rejects with `CommandFailed` when the core does not keep it. */
  onSubmit(choice: CommandInput<'personas.set'>): Promise<void>
  /** Told which persona is picked to answer each time the user changes it, before anything is sent. */
  onPick?(persona: PersonaId): void
}

/**
 * Name the personas and pick the one that answers. First launch and settings both show this.
 *
 * Every persona gets the same card, built from its data alone. The form holds only what the user changed,
 * so what they left alone keeps following the settings. Problems appear once the user has tried to send,
 * and then follow what they type.
 */
export function PersonasForm({ personas, active, submitLabel, busyLabel, doneLabel, onSubmit, onPick }: PersonasFormProps) {
  const [draft, setDraft] = useState<PersonaDraft>(NO_EDITS)
  const [tried, setTried] = useState(false)
  const [state, setState] = useState<{ is: 'idle' } | { is: 'busy' } | { is: 'done' } | { is: 'refused'; why: string }>({ is: 'idle' })
  const group = useId()

  const problems = tried ? problemsOf(personas, draft) : {}
  const change = (next: PersonaDraft) => {
    setDraft(next)
    if (state.is !== 'busy') setState({ is: 'idle' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (state.is === 'busy' || Object.keys(problemsOf(personas, draft)).length > 0) return
    setState({ is: 'busy' })
    try {
      await onSubmit(choiceOf(personas, active, draft))
      // Kept: the form goes back to showing the settings, where the names now are in their kept form.
      setDraft(NO_EDITS)
      setTried(false)
      setState({ is: 'done' })
    } catch (error) {
      setState({ is: 'refused', why: refusalCopy(error instanceof CommandFailed ? error.code : 'failed') })
    }
  }

  return (
    <form className="grid gap-6" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Personalities</legend>
        {personas.map((persona, index) => {
          const problem = problems[persona.id]
          const answers = activeIn(draft, active) === persona.id
          return (
            <div
              key={persona.id}
              style={accentStyle(persona.accent)}
              className={cn(
                'relative grid gap-4 rounded-lg border bg-raised/95 p-5 transition-colors duration-300 ease-soft',
                answers ? 'border-accent/50 bg-accent/[0.03]' : 'border-line hover:border-line-strong'
              )}
            >
              <div className="flex items-center gap-4">
                <Orb size={64} mood={answers ? 'idle' : 'asleep'} className="-m-2 shrink-0" />
                <div className="grid gap-1">
                  <Eyebrow accent>{stanceCopy[persona.stance].label}</Eyebrow>
                  <p className="text-sm text-text-soft leading-relaxed">{stanceCopy[persona.stance].summary}</p>
                </div>
              </div>
              <TextField
                label="Name"
                value={nameIn(draft, persona)}
                maxLength={PERSONA_NAME_MAX_LENGTH * 2}
                first={index === 0}
                problem={problem && nameProblemCopy[problem]}
                onChange={(name) => change({ ...draft, names: { ...draft.names, [persona.id]: name } })}
              />
              <label className="-mt-1 flex cursor-pointer items-center gap-2.5 border-line border-t pt-4 text-text-soft text-xs has-checked:text-text">
                <input
                  type="radio"
                  name={group}
                  checked={answers}
                  onChange={() => {
                    change({ ...draft, active: persona.id })
                    onPick?.(persona.id)
                  }}
                  className="grid size-4 cursor-pointer appearance-none place-content-center rounded-full border border-line-strong transition before:size-2 before:scale-0 before:rounded-full before:bg-accent before:transition before:content-[''] checked:border-accent checked:before:scale-100"
                />
                Answers by default
              </label>
            </div>
          )
        })}
      </fieldset>

      <div className="flex items-center gap-4">
        <Button kind="primary" size="lg" type="submit" disabled={state.is === 'busy'}>
          {state.is === 'busy' ? busyLabel : submitLabel}
        </Button>
        <span role="status" className={cn('text-sm', state.is === 'refused' ? 'text-danger' : 'text-text-soft text-xs')}>
          {state.is === 'refused' ? state.why : state.is === 'done' ? doneLabel : undefined}
        </span>
      </div>
    </form>
  )
}
