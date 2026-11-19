import type { Exchange, PlanStep } from '@repo/protocol'

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

/** The latest of a thread's requests still running, from the conversation's lines. */
const runningOf = (thread: string, exchanges: readonly Exchange[]) => exchanges.findLast((line) => line.thread === thread && line.outcome === 'running')

/** What a thread at work is answering, in the person's words: the latest of its requests still running. */
export function answeringOf(thread: string, exchanges: readonly Exchange[]): string | undefined {
  const said = runningOf(thread, exchanges)?.said.trim()
  return said === '' ? undefined : said
}

/**
 * What a thread at work is doing, in a few words: where its plan stands, which says more of the work than the
 * request it answers, else that request. Nothing for a thread whose request is not a line of the conversation, as
 * a sub-thread's is not.
 */
export function doingOf(thread: string, exchanges: readonly Exchange[]): string | undefined {
  return planLine(runningOf(thread, exchanges)?.plan) ?? answeringOf(thread, exchanges)
}
