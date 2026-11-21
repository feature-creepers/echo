import type { BlockProps } from '@repo/catalog'
import { cn } from '../../primitives/cn.ts'
import { CheckGlyph } from '../../primitives/icons.tsx'
import { TONE_TEXT } from '../tones.ts'
import { Markdown } from './markdown.tsx'

export function Heading({ props }: { props: BlockProps<'Heading'> }) {
  if (props.level === 1) return <h2 className="text-balance font-semibold text-base leading-snug tracking-[-0.015em]">{props.text}</h2>
  if (props.level === 2) return <h3 className="text-balance font-medium text-sm leading-snug tracking-[-0.01em]">{props.text}</h3>
  return <h4 className="font-medium text-text-soft text-xs leading-snug">{props.text}</h4>
}

export function Text({ props }: { props: BlockProps<'Text'> }) {
  const size = { small: 'text-xs leading-normal', normal: 'text-[0.8125rem] leading-relaxed', large: 'text-[0.9375rem] leading-relaxed' }[props.size]
  return <p className={cn('text-pretty', size, TONE_TEXT[props.tone], props.weight === 'medium' && 'font-medium')}>{props.text}</p>
}

export function Badge({ props }: { props: BlockProps<'Badge'> }) {
  return (
    <span
      className={cn('inline-flex h-5 w-fit items-center gap-1.5 border border-current/25 bg-current/[0.07] px-1.5 text-[0.6875rem]', TONE_TEXT[props.tone])}
    >
      {props.text}
    </span>
  )
}

export function KeyValue({ props }: { props: BlockProps<'KeyValue'> }) {
  return (
    <dl className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-4 gap-y-1">
      {props.items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="pt-px text-label text-text-faint">{item.label}</dt>
          <dd className="text-[0.8125rem] leading-snug">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function List({ props }: { props: BlockProps<'List'> }) {
  return (
    <ul className="grid gap-1">
      {props.items.map((item, index) => (
        <li key={index} className="flex gap-2">
          {props.marker === 'bullet' && <span className="mt-[0.5625rem] size-1 shrink-0 bg-text-faint" />}
          {props.marker === 'number' && <span className="w-4 shrink-0 pt-px text-right text-[0.6875rem] text-text-faint leading-5">{index + 1}</span>}
          {props.marker === 'check' && (
            <span
              className={cn(
                'mt-[0.1875rem] flex size-3.5 shrink-0 items-center justify-center border [&_svg]:size-3',
                item.checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong'
              )}
            >
              {item.checked && <CheckGlyph />}
            </span>
          )}
          <div className="grid min-w-0 gap-0.5">
            <span className={cn('text-[0.8125rem] leading-5', item.checked && 'text-text-soft line-through decoration-text-faint')}>{item.text}</span>
            {item.detail && <span className="text-text-soft text-xs leading-snug">{item.detail}</span>}
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
          <li key={index} className="grid grid-cols-[1.25rem_1fr] gap-x-2.5">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center border text-[0.625rem] [&_svg]:size-3',
                  step.state === 'done' && 'border-accent/50 bg-accent/15 text-accent',
                  step.state === 'current' && 'border-accent text-accent',
                  step.state === 'todo' && 'border-line-strong text-text-faint'
                )}
              >
                {step.state === 'done' ? <CheckGlyph /> : index + 1}
              </span>
              {!last && <span className={cn('my-1 w-px flex-1', step.state === 'done' ? 'bg-accent/40' : 'bg-line-strong')} />}
            </div>
            <div className={cn('grid content-start gap-0.5', !last && 'pb-2.5')}>
              <span className={cn('font-medium text-[0.8125rem] leading-5', step.state === 'todo' && 'text-text-soft')}>{step.title}</span>
              {step.detail && <span className="text-pretty text-text-soft text-xs leading-snug">{step.detail}</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function Prose({ props }: { props: BlockProps<'Prose'> }) {
  return <Markdown text={props.markdown} className="gap-2 text-[0.8125rem]" />
}
