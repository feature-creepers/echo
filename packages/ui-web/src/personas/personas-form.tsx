import { CommandFailed } from '@repo/client'
import { type CommandInput, PERSONA_NAME_MAX_LENGTH, type Persona, type PersonaId } from '@repo/protocol'
import { type FormEvent, useId, useState } from 'react'
import { Eye } from '../presence/eye.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { TextField } from '../primitives/text-field.tsx'
import { accentStyle } from '../styles/accent.ts'
import { nameProblemCopy, refusalCopy, stanceCopy } from './copy.ts'
import { activeIn, asTyped, choiceOf, NO_EDITS, nameIn, type PersonaDraft, problemsOf } from './draft.ts'

interface PersonasFormProps {
  personas: readonly Persona[]
  /** The persona that answers now. */
  active: PersonaId
  /** What the button says. */
  submitLabel: string
  /** Said beside the button once the core has kept the choice. Left out, nothing is said. */
  doneLabel?: string
  /** Send the choice to the core. Rejects with `CommandFailed` when the core does not keep it. */
  onSubmit(choice: CommandInput<'personas.set'>): Promise<void>
  /** Told which persona is picked to answer each time the person changes it, before anything is sent. */
  onPick(persona: PersonaId): void
}

/**
 * Name the personas and pick the one that answers. First launch and settings both show this.
 *
 * Every persona gets the same row, built from its data alone. The form holds only what the person changed,
 * so what they left alone keeps following the settings. Problems appear once the person has tried to send,
 * and then follow what they type.
 */
export function PersonasForm({ personas, active, submitLabel, doneLabel, onSubmit, onPick }: PersonasFormProps) {
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
      <fieldset className="divide-y divide-line border-text border-t-2">
        <legend className="sr-only">Personalities</legend>
        {personas.map((persona, index) => {
          const problem = problems[persona.id]
          const answers = activeIn(draft, active) === persona.id
          return (
            <div key={persona.id} style={accentStyle(persona.accent, persona.look)} className="grid items-start gap-x-6 gap-y-3 py-4 sm:grid-cols-[1fr_16rem]">
              <div className="flex min-w-0 items-start gap-4">
                <Eye size={56} mood={answers ? 'idle' : 'asleep'} className="shrink-0" />
                <div className="grid min-w-0 gap-1.5">
                  <span className={cn('display min-h-6 truncate text-[1.75rem] leading-6', !answers && 'text-text-soft')}>{nameIn(draft, persona)}</span>
                  <Eyebrow>{stanceCopy[persona.stance].label}</Eyebrow>
                  <p className="max-w-sm text-text-soft text-xs leading-relaxed">{stanceCopy[persona.stance].summary}</p>
                  <label className="caps mt-1 flex w-fit cursor-pointer items-center gap-2 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text has-checked:text-text">
                    <input
                      type="radio"
                      name={group}
                      checked={answers}
                      onChange={() => {
                        change({ ...draft, active: persona.id })
                        onPick(persona.id)
                      }}
                      className="size-3.5 shrink-0 cursor-pointer appearance-none border border-line-strong transition-colors duration-(--duration-quick) ease-soft checked:border-text checked:bg-text"
                    />
                    Answers by default
                  </label>
                </div>
              </div>
              <TextField
                label="Name"
                value={nameIn(draft, persona)}
                maxLength={PERSONA_NAME_MAX_LENGTH * 2}
                first={index === 0}
                transform={asTyped}
                problem={problem && nameProblemCopy[problem]}
                onChange={(name) => change({ ...draft, names: { ...draft.names, [persona.id]: name } })}
              />
            </div>
          )
        })}
      </fieldset>

      <div className="flex items-center gap-4">
        <Button kind="primary" size="lg" type="submit" disabled={state.is === 'busy'}>
          {state.is === 'busy' ? 'Saving…' : submitLabel}
        </Button>
        <span role="status" className={cn('text-xs', state.is === 'refused' ? 'text-danger' : 'caps text-text-soft')}>
          {state.is === 'refused' ? state.why : state.is === 'done' ? doneLabel : undefined}
        </span>
      </div>
    </form>
  )
}
