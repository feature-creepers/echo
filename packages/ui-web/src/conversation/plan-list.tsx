import type { PlanStep } from '@repo/protocol'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { CheckGlyph } from '../primitives/icons.tsx'
import { planCount } from './plan.ts'

/**
 * The plan a thread kept for a request (docs/SPEC.md, section 7.11), its harness's own to-do list: each step in
 * order, done ones ticked and faint, the one under way in the accent, those to come soft.
 */
export function PlanList({ plan }: { plan: readonly PlanStep[] | undefined }) {
  if (plan === undefined || plan.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-1">
      <span className="flex items-baseline justify-between gap-3">
        <Eyebrow>Plan</Eyebrow>
        <span className="text-label text-text-faint tabular-nums">{planCount(plan)}</span>
      </span>
      <ol className="grid grid-cols-1 gap-px rounded-md border border-line px-3 py-2">
        {plan.map((step, index) => (
          <li
            // A plan is told whole each time: a step is known by its place and its words.
            key={`${index}-${step.text}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex min-w-0 items-start gap-2.5 py-0.5 text-xs leading-relaxed"
          >
            <span className="flex h-[1.125rem] w-3.5 shrink-0 items-center justify-center">
              {step.state === 'done' ? (
                <span className="text-text-faint">
                  <CheckGlyph size={12} />
                </span>
              ) : (
                <span className={cn('size-1.5 rounded-full', step.state === 'current' ? 'bg-accent' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)]')} />
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
