import type { PlanStep } from '@repo/protocol'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { CheckGlyph } from '../primitives/icons.tsx'
import { planCount } from './plan.ts'

/**
 * The plan a thread kept for a request (docs/SPEC.md, section 7.11), its harness's own to-do list: each step in
 * order on a row of its own, done ones ticked and faint, the one under way marked in the accent, those to come marked
 * by a square drawn as a line.
 */
export function PlanList({ plan }: { plan: readonly PlanStep[] | undefined }) {
  if (plan === undefined || plan.length === 0) return null
  return (
    <div className="grid grid-cols-1">
      <span className="flex items-baseline justify-between gap-3 pb-1">
        <Eyebrow>Plan</Eyebrow>
        <span className="caps text-text-soft tabular-nums">{planCount(plan)}</span>
      </span>
      <ol className="grid grid-cols-1 border-text border-t-2">
        {plan.map((step, index) => (
          <li
            // A plan is told whole each time: a step is known by its place and its words.
            key={`${index}-${step.text}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex min-w-0 items-start gap-2.5 border-line border-t py-1.5 text-[0.8125rem] leading-snug first:border-t-0"
          >
            <span className="flex h-[1.1875rem] w-3 shrink-0 items-center justify-center">
              {step.state === 'done' ? (
                <span className="text-text-faint">
                  <CheckGlyph size={12} />
                </span>
              ) : (
                <span className={cn('size-2', step.state === 'current' ? 'animate-pulse bg-accent' : 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]')} />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 [overflow-wrap:anywhere]',
                step.state === 'done' && 'text-text-faint',
                step.state === 'current' && 'text-text',
                step.state === 'todo' && 'text-text-soft'
              )}
            >
              {step.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
