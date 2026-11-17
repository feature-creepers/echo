import type { BlockProps } from '@repo/catalog'
import { cn } from '../../primitives/cn.ts'
import { CheckGlyph } from '../../primitives/icons.tsx'
import { TONE_TEXT } from '../tones.ts'
import { Markdown } from './markdown.tsx'

export function Heading({ props }: { props: BlockProps<'Heading'> }) {
  if (props.level === 1) return <h2 className="text-balance font-medium text-3xl tracking-tight">{props.text}</h2>
  if (props.level === 2) return <h3 className="text-balance font-medium text-xl tracking-tight">{props.text}</h3>
  return <h4 className="font-medium text-base text-text-soft">{props.text}</h4>
}

export function Text({ props }: { props: BlockProps<'Text'> }) {
  const size = { small: 'text-sm', normal: 'text-[0.9375rem]', large: 'text-lg' }[props.size]
  return <p className={cn('text-pretty leading-relaxed', size, TONE_TEXT[props.tone], props.weight === 'medium' && 'font-medium')}>{props.text}</p>
}

export function Badge({ props }: { props: BlockProps<'Badge'> }) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-sm border border-current/25 bg-current/8 px-2 py-0.5 font-mono text-label uppercase',
        TONE_TEXT[props.tone]
      )}
    >
      {props.text}
    </span>
  )
}

export function KeyValue({ props }: { props: BlockProps<'KeyValue'> }) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-6 gap-y-2.5">
      {props.items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="pt-0.5 font-mono text-label text-text-faint uppercase">{item.label}</dt>
          <dd className="text-[0.9375rem]">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function List({ props }: { props: BlockProps<'List'> }) {
  return (
    <ul className="grid gap-2">
      {props.items.map((item, index) => (
        <li key={index} className="flex gap-3">
          {props.marker === 'bullet' && <span className="mt-[0.6rem] size-1 shrink-0 rounded-full bg-accent" />}
          {props.marker === 'number' && <span className="w-5 shrink-0 pt-0.5 text-right font-mono text-accent text-xs">{index + 1}</span>}
          {props.marker === 'check' && (
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                item.checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
              )}
            >
              {item.checked && <CheckGlyph />}
            </span>
          )}
          <div className="grid gap-0.5">
            <span className={cn('text-[0.9375rem] leading-relaxed', item.checked && 'text-text-soft line-through decoration-text-faint')}>{item.text}</span>
            {item.detail && <span className="text-sm text-text-soft">{item.detail}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function Steps({ props }: { props: BlockProps<'Steps'> }) {
  return (
    <ol className="grid">
      {props.items.map((step, index) => {
        const last = index === props.items.length - 1
        return (
          <li key={index} className="grid grid-cols-[1.75rem_1fr] gap-x-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs',
                  step.state === 'done' && 'border-accent bg-accent text-accent-ink',
                  step.state === 'current' && 'border-accent text-accent shadow-[0_0_16px_-4px_var(--accent)]',
                  step.state === 'todo' && 'border-line-strong text-text-faint'
                )}
              >
                {step.state === 'done' ? <CheckGlyph /> : index + 1}
              </span>
              {!last && <span className={cn('my-1 w-px flex-1', step.state === 'done' ? 'bg-accent/50' : 'bg-line-strong')} />}
            </div>
            <div className={cn('grid content-start gap-1 pt-1', !last && 'pb-5')}>
              <span className={cn('font-medium text-[0.9375rem]', step.state === 'todo' && 'text-text-soft')}>{step.title}</span>
              {step.detail && <span className="text-pretty text-sm text-text-soft leading-relaxed">{step.detail}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function Prose({ props }: { props: BlockProps<'Prose'> }) {
  return <Markdown text={props.markdown} />
}
