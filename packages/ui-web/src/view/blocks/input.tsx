import type { BlockProps } from '@repo/catalog'
import { type FormEvent, useState } from 'react'
import { Button as AppButton } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { useViewActions } from '../context.ts'

export function Button({ props }: { props: BlockProps<'Button'> }) {
  const { say } = useViewActions()
  return (
    <AppButton kind={props.emphasis === 'primary' ? 'primary' : 'secondary'} className="w-fit" onClick={() => say(props.say)}>
      {props.label}
    </AppButton>
  )
}

export function Choice({ props }: { props: BlockProps<'Choice'> }) {
  const { say } = useViewActions()
  const [picked, setPicked] = useState<number>()
  return (
    <div className="grid gap-3">
      {props.question && <p className="font-medium text-[0.9375rem]">{props.question}</p>}
      <div className="grid gap-2">
        {props.options.map((option, index) => (
          <button
            key={index}
            type="button"
            disabled={picked !== undefined}
            onClick={() => {
              setPicked(index)
              say(option.say)
            }}
            className={cn(
              'grid gap-0.5 rounded-md border px-4 py-3 text-left transition duration-150 ease-soft',
              picked === index ? 'border-accent bg-accent/10' : 'border-line bg-surface/70 hover:not-disabled:border-line-strong hover:not-disabled:bg-raised',
              picked !== undefined && picked !== index && 'opacity-45'
            )}
          >
            <span className="text-[0.9375rem]">{option.label}</span>
            {option.detail && <span className="text-sm text-text-soft">{option.detail}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Field({ props }: { props: BlockProps<'Field'> }) {
  const { say } = useViewActions()
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() === '') return
    say(`${props.say} ${value.trim()}`)
    setSent(true)
  }
  return (
    <form onSubmit={send} className="grid gap-1.5">
      <Eyebrow>{props.label}</Eyebrow>
      <div className="flex gap-2">
        <input
          value={value}
          disabled={sent}
          onChange={(event) => setValue(event.target.value)}
          placeholder={props.placeholder}
          aria-label={props.label}
          className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-ground px-3 text-[0.9375rem] outline-none transition placeholder:text-text-faint focus-visible:border-accent disabled:opacity-60"
        />
        <AppButton type="submit" kind="primary" disabled={sent || value.trim() === ''}>
          {sent ? 'Sent' : 'Send'}
        </AppButton>
      </div>
    </form>
  )
}
