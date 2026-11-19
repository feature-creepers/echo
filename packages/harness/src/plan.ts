import type { SessionEvent } from '@repo/core'
import { asArray, asObject, asString } from './process/json.ts'

/** A step of a plan, as the core takes it. */
type PlanStep = Extract<SessionEvent, { type: 'plan' }>['steps'][number]

/**
 * The plan in Claude Code's own to-do list: what its `TodoWrite` tool is given, the whole list each time. A step
 * says what it is (`content`), and where it stands: `pending`, `in_progress` or `completed`. Nothing when the input
 * is not a list.
 */
export function planFromTodos(input: unknown): PlanStep[] | undefined {
  const todos = asObject(input)?.todos
  if (!Array.isArray(todos)) return undefined
  return stepsOf(
    todos.map((todo) => {
      const item = asObject(todo)
      return { text: asString(item?.content), status: asString(item?.status) }
    }),
    { pending: 'todo', in_progress: 'current', completed: 'done' }
  )
}

/**
 * The plan Codex keeps with its plan tool, as its app server tells it (`turn/plan/updated`): each step's words, and
 * `pending`, `inProgress` or `completed`. Nothing when the notification holds no plan.
 */
export function planFromCodex(params: unknown): PlanStep[] | undefined {
  const plan = asObject(params)?.plan
  if (!Array.isArray(plan)) return undefined
  return stepsOf(
    asArray(plan).map((step) => {
      const item = asObject(step)
      return { text: asString(item?.step), status: asString(item?.status) }
    }),
    { pending: 'todo', inProgress: 'current', completed: 'done' }
  )
}

/** Steps with words, each in the state its harness names; a state not known is a step still to do. */
function stepsOf(read: { text: string | undefined; status: string | undefined }[], states: Record<string, PlanStep['state']>): PlanStep[] {
  return read.flatMap(({ text, status }) => {
    const words = text?.trim()
    if (!words) return []
    return [{ text: words, state: (status !== undefined && Object.hasOwn(states, status) ? states[status] : undefined) ?? 'todo' }]
  })
}
