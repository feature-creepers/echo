import type { Access, CommandInput } from '@repo/protocol'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { TextField } from '../primitives/text-field.tsx'
import { SettingRow } from '../settings/rows.tsx'

interface ConfirmationRowProps {
  access: Access
  busy: boolean
  change(asked: CommandInput<'access.set'>): Promise<void>
}

/** The fewest words a phrase has, as the core asks. */
const MIN_WORDS = 2

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/**
 * The phrase that allows aloud what sends, pays or publishes (docs/SPEC.md, section 12.4, approvals away from the
 * screen). The core keeps only its fingerprint, so it is never shown again: it can be changed or removed. Pressing a
 * card's button, or typing at the screen, still answers without it.
 */
export function ConfirmationRow({ access, busy, change }: ConfirmationRowProps) {
  const [editing, setEditing] = useState(false)
  const [phrase, setPhrase] = useState('')
  const set = access.confirmation !== null
  const enough = wordCount(phrase) >= MIN_WORDS

  const save = async () => {
    await change({ confirmationPhrase: phrase })
    setPhrase('')
    setEditing(false)
  }

  return (
    <SettingRow
      title="Confirmation phrase"
      detail={
        editing
          ? 'Two words at least, easy for you to say and unlikely to be said by chance. It is not shown again once saved.'
          : set
            ? 'Said aloud, a yes to what sends, pays or publishes counts only with your phrase. The card’s buttons and typed answers still work.'
            : 'Set a phrase, and a yes said aloud to what sends, pays or publishes counts only with it, so nobody else in the room can allow it.'
      }
    >
      {editing ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (enough && !busy) void save()
          }}
        >
          <TextField label="Your phrase" value={phrase} onChange={setPhrase} maxLength={200} first className="w-56" />
          <Button kind="primary" size="sm" type="submit" disabled={!enough || busy}>
            Save
          </Button>
          <Button
            kind="quiet"
            size="sm"
            onClick={() => {
              setPhrase('')
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          {set && (
            <Button kind="quiet" size="sm" disabled={busy} onClick={() => void change({ confirmationPhrase: null })}>
              Remove
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={() => setEditing(true)}>
            {set ? 'Change' : 'Set a phrase'}
          </Button>
        </div>
      )}
    </SettingRow>
  )
}
