import { useActions } from '@json-render/react'
import type { BlockProps } from '@repo/catalog'
import { CommandFailed } from '@repo/client'
import { FieldControl, FieldLabel, Field as FieldRoot } from '@ui-sdk/react/field'
import { Listbox, ListboxItem } from '@ui-sdk/react/listbox'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Button as AppButton } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { useViewActions } from '../context.ts'

/** How long a button's failure stays under it, in milliseconds: long enough to read, gone at the next press. */
const PROBLEM_MS = 6_000

/** Say something to the assistant on the person's behalf, through the renderer's actions. */
function useSay() {
  const { execute } = useActions()
  return (text: string) => void execute({ action: 'say', params: { text } }).catch(() => undefined)
}

/**
 * A button that says something to the assistant, or acts on the computer at once (docs/SPEC.md, section 9.5). Acting,
 * it is busy until the steps are done, so a press is not sent twice by accident; failing, it says why under it.
 */
export function Button({ props }: { props: BlockProps<'Button'> }) {
  const { act } = useViewActions()
  const { execute } = useActions()
  const say = useSay()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const press = () => {
    if (props.say !== undefined) return say(props.say)
    if (!props.act || !act) return
    clearTimeout(timer.current)
    setProblem(undefined)
    setBusy(true)
    execute({ action: 'act', params: { steps: props.act } })
      .catch((error: unknown) => {
        setProblem(error instanceof CommandFailed && error.detail ? error.detail : 'It could not be done.')
        timer.current = setTimeout(() => setProblem(undefined), PROBLEM_MS)
      })
      .finally(() => setBusy(false))
  }

  // An act needs a computer: where none can be reached, the button stays, unpressable.
  const unpressable = props.say === undefined && !act
  return (
    <div className="grid w-fit max-w-full gap-1">
      <AppButton
        kind={props.emphasis === 'primary' ? 'primary' : 'secondary'}
        size="sm"
        className={cn('w-fit', busy && 'cursor-progress')}
        disabled={unpressable}
        aria-busy={busy}
        onClick={busy ? undefined : press}
      >
        {props.label}
      </AppButton>
      {problem && (
        <p role="alert" className="max-w-64 text-danger text-xs break-words">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Answers to pick one of: Up, Down, Home, End and typing move between them, and Enter or a press picks one, once. */
export function Choice({ props }: { props: BlockProps<'Choice'> }) {
  const say = useSay()
  const [picked, setPicked] = useState<number>()
  return (
    <div className="grid gap-2">
      {props.question && <p className="font-medium text-sm">{props.question}</p>}
      <Listbox
        activation="manual"
        aria-label={props.question ?? 'Answers'}
        value={picked === undefined ? null : String(picked)}
        readOnly={picked !== undefined}
        onValueChange={(value) => {
          const index = Number(value)
          const option = props.options[index]
          if (picked !== undefined || !option) return
          setPicked(index)
          say(option.say)
        }}
        className="grid gap-1"
      >
        {props.options.map((option, index) => (
          <ListboxItem
            key={index}
            value={String(index)}
            label={option.label}
            className={cn(
              'grid gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-(--duration-quick) ease-soft',
              picked === index
                ? 'border-accent/60 bg-accent/10'
                : picked === undefined
                  ? 'cursor-pointer border-line bg-white/[0.018] hover:border-line-strong hover:bg-white/[0.04]'
                  : 'border-line bg-white/[0.018] opacity-45'
            )}
          >
            <span className="text-sm">{option.label}</span>
            {option.detail && <span className="text-text-soft text-xs">{option.detail}</span>}
          </ListboxItem>
        ))}
      </Listbox>
    </div>
  )
}

/** A line to type an answer in, sent once; its label names its input, and pressing it puts the cursor there. */
export function Field({ props }: { props: BlockProps<'Field'> }) {
  const say = useSay()
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() === '') return
    say(`${props.say} ${value.trim()}`)
    setSent(true)
  }
  return (
    <form onSubmit={send}>
      <FieldRoot className="grid gap-1">
        <FieldLabel>
          <Eyebrow>{props.label}</Eyebrow>
        </FieldLabel>
        <div className="flex gap-1.5">
          <FieldControl
            value={value}
            disabled={sent}
            onChange={(event) => setValue(event.target.value)}
            placeholder={props.placeholder}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] px-2.5 text-sm transition-colors duration-(--duration-quick) placeholder:text-text-faint disabled:opacity-60"
          />
          <AppButton type="submit" kind="primary" disabled={sent || value.trim() === ''}>
            {sent ? 'Sent' : 'Send'}
          </AppButton>
        </div>
      </FieldRoot>
    </form>
  )
}
