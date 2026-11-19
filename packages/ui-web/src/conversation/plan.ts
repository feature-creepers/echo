import type { PlanStep } from '@repo/protocol'

/** How many steps of a plan are done, out of how many: "2 of 5 done". */
export function planCount(plan: readonly PlanStep[]): string {
  return `${plan.filter((step) => step.state === 'done').length} of ${plan.length} done`
}

/**
 * Where a thread's work stands, in a few words for the list of what is at work: the step under way, or the next to
 * do, with its place in the plan ("Step 2 of 5 · Fix the test"). Nothing without a plan; "All 5 steps done" when
 * every one is.
 */
export function planLine(plan: readonly PlanStep[] | undefined): string | undefined {
  if (plan === undefined || plan.length === 0) return undefined
  const current = plan.findIndex((step) => step.state === 'current')
  const at = current >= 0 ? current : plan.findIndex((step) => step.state === 'todo')
  if (at < 0) return plan.length === 1 ? 'Its one step is done' : `All ${plan.length} steps done`
  return `Step ${at + 1} of ${plan.length} · ${plan[at]?.text ?? ''}`
}
