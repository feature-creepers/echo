import type { BlockProps } from '@repo/catalog'
import { type FormEvent, useState } from 'react'
import { Button as AppButton } from '../../primitives/button.tsx'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'
import { useViewActions } from '../context.ts'

export function Button({ props }: { props: BlockProps<'Button'> }) {
  const { say } = useViewActions()
  return (
    <AppButton kind={props.emphasis === 'primary' ? 'primary' : 'secondary'} size="sm" className="w-fit" onClick={() => say(props.say)}>
      {props.label}
    </AppButton>
  )
}

export function Choice({ props }: { props: BlockProps<'Choice'> }) {
  const { say } = useViewActions()
  const [picked, setPicked] = useState<number>()
  return (
    <div className="grid gap-2">
      {props.question && <p className="font-medium text-sm">{props.question}</p>}
      <div className="grid gap-1">
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
              'grid gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-(--duration-quick) ease-soft',
              picked === index
                ? 'border-accent/60 bg-accent/10'
                : 'border-line bg-white/[0.018] hover:not-disabled:border-line-strong hover:not-disabled:bg-white/[0.04]',
              picked !== undefined && picked !== index && 'opacity-45'
            )}
          >
            <span className="text-sm">{option.label}</span>
            {option.detail && <span className="text-text-soft text-xs">{option.detail}</span>}
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
    <form onSubmit={send} className="grid gap-1">
      <Eyebrow>{props.label}</Eyebrow>
      <div className="flex gap-1.5">
        <input
          value={value}
          disabled={sent}
          onChange={(event) => setValue(event.target.value)}
          placeholder={props.placeholder}
          aria-label={props.label}
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-ground px-2.5 text-sm outline-none transition-colors duration-(--duration-quick) placeholder:text-text-faint focus-visible:border-accent/70 focus-visible:outline-none disabled:opacity-60"
        />
        <AppButton type="submit" kind="primary" disabled={sent || value.trim() === ''}>
          {sent ? 'Sent' : 'Send'}
        </AppButton>
      </div>
    </form>
  )
}
