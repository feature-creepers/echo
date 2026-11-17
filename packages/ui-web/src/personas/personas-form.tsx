import { CommandFailed } from '@repo/client'
import { PERSONA_NAME_MAX_LENGTH, type CommandInput, type Persona, type PersonaId } from '@repo/protocol'
import { useId, useState, type FormEvent } from 'react'
import { Button } from '../primitives/button.tsx'
import { TextField } from '../primitives/text-field.tsx'
import { accentStyle } from '../styles/theme.ts'
import { nameProblemCopy, refusalCopy, stanceCopy } from './copy.ts'
import { NO_EDITS, activeIn, choiceOf, nameIn, problemsOf, type PersonaDraft } from './draft.ts'
import { PersonaMark } from './persona-mark.tsx'
import styles from './personas-form.module.css'

export interface PersonasFormProps {
  personas: readonly Persona[]
  /** The persona that answers now. */
  active: PersonaId
  /** What the button says, and what it says while the choice is on its way. */
  submitLabel: string
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
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <fieldset className={styles.cards}>
        <legend className={styles.legend}>Personalities</legend>
        {personas.map((persona, index) => {
          const problem = problems[persona.id]
          const answers = activeIn(draft, active) === persona.id
          return (
            <div key={persona.id} className={styles.card} data-active={answers} style={accentStyle(persona.accent)}>
              <div className={styles.heading}>
                <PersonaMark size="small" />
                <span className={styles.stance}>{stanceCopy[persona.stance].label}</span>
              </div>
              <p className={styles.summary}>{stanceCopy[persona.stance].summary}</p>
              <TextField
                label="Name"
                value={nameIn(draft, persona)}
                maxLength={PERSONA_NAME_MAX_LENGTH * 2}
                autoFocus={index === 0}
                problem={problem && nameProblemCopy[problem]}
                onChange={(name) => change({ ...draft, names: { ...draft.names, [persona.id]: name } })}
              />
              <label className={styles.choice}>
                <input
                  type="radio"
                  name={group}
                  checked={answers}
                  onChange={() => {
                    change({ ...draft, active: persona.id })
                    onPick?.(persona.id)
                  }}
                />
                Answers by default
              </label>
            </div>
          )
        })}
      </fieldset>

      <div className={styles.footer}>
        <Button kind="primary" type="submit" disabled={state.is === 'busy'}>
          {state.is === 'busy' ? busyLabel : submitLabel}
        </Button>
        <span role="status" className={state.is === 'refused' ? styles.failure : styles.done}>
          {state.is === 'refused' ? state.why : state.is === 'done' ? doneLabel : undefined}
        </span>
      </div>
    </form>
  )
}
