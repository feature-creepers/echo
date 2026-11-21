import type { BlockProps } from '@repo/catalog'
import { cn } from '../../primitives/cn.ts'
import { CheckGlyph } from '../../primitives/icons.tsx'
import { TONE_TEXT } from '../tones.ts'
import { Markdown } from './markdown.tsx'

/** A row of a list: about 34 px for one line, a hairline over it, and a rule of the full ink over the first. */
const ROW = 'border-line border-t py-[0.4375rem] first:border-text first:border-t-2'

export function Heading({ props }: { props: BlockProps<'Heading'> }) {
  if (props.level === 1) return <h2 className="text-balance font-semibold text-base leading-snug tracking-[-0.01em]">{props.text}</h2>
  if (props.level === 2) return <h3 className="text-balance font-semibold text-sm leading-snug tracking-[-0.005em]">{props.text}</h3>
  return <h4 className="font-semibold text-text-soft text-xs leading-snug">{props.text}</h4>
}

export function Text({ props }: { props: BlockProps<'Text'> }) {
  const size = { small: 'text-xs leading-normal', normal: 'text-[0.8125rem] leading-relaxed', large: 'text-[0.9375rem] leading-relaxed' }[props.size]
  return <p className={cn('text-pretty', size, TONE_TEXT[props.tone], props.weight === 'medium' && 'font-medium')}>{props.text}</p>
}

/** A state or a category: a square mark and a label in capitals, in the tone's colour. */
export function Badge({ props }: { props: BlockProps<'Badge'> }) {
  return (
    <span className={cn('caps inline-flex w-fit items-center gap-1.5', TONE_TEXT[props.tone])}>
      <span aria-hidden="true" className="size-2 shrink-0 bg-current" />
      {props.text}
    </span>
  )
}

export function KeyValue({ props }: { props: BlockProps<'KeyValue'> }) {
  return (
    <dl className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-4">
      {props.items.map((item, index) => (
        <div key={index} className={cn('col-span-2 grid grid-cols-subgrid items-baseline', ROW)}>
          <dt className="caps text-text-soft">{item.label}</dt>
          <dd className="text-[0.8125rem] leading-5">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function List({ props }: { props: BlockProps<'List'> }) {
  return (
    <ul className="grid">
      {props.items.map((item, index) => (
        <li key={index} className={cn('flex gap-2.5', ROW)}>
          {props.marker === 'bullet' && <span className="mt-1.5 size-2 shrink-0 bg-text" />}
          {props.marker === 'number' && <span className="caps w-4 shrink-0 pt-0.5 text-right text-text-soft">{index + 1}</span>}
          {props.marker === 'check' && (
            <span
              className={cn(
                'mt-[0.1875rem] flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3',
                item.checked ? 'bg-text text-ground' : 'shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]'
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
          <li key={index} className="grid grid-cols-[1.25rem_1fr] gap-x-3">
            <div className="flex flex-col items-center">
              {/* Done is a plane of the ink, the current step a line of it, what is left a fainter line. */}
              <span
                className={cn(
                  'caps flex size-5 shrink-0 items-center justify-center [&_svg]:size-3',
                  step.state === 'done' && 'bg-text text-ground',
                  step.state === 'current' && 'text-text shadow-[inset_0_0_0_1px_var(--color-text)]',
                  step.state === 'todo' && 'text-text-faint shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
                )}
              >
                {step.state === 'done' ? <CheckGlyph /> : index + 1}
              </span>
              {!last && <span className={cn('my-1 w-px flex-1', step.state === 'done' ? 'bg-text' : 'bg-line-strong')} />}
            </div>
            <div className={cn('grid content-start gap-0.5', !last && 'pb-3')}>
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
