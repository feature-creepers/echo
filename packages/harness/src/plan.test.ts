import { describe, expect, it } from 'vitest'
import { planFromCodex, planFromTodos } from './plan.ts'

describe("a harness's plan", () => {
  const todos: { name: string; input: unknown; plan: ReturnType<typeof planFromTodos> }[] = [
    {
      name: "Claude Code's to-do list, each step in its state",
      input: {
        todos: [
          { content: 'Read the handle', status: 'completed', activeForm: 'Reading the handle' },
          { content: 'Make it wider', status: 'in_progress', activeForm: 'Making it wider' },
          { content: 'Run the checks', status: 'pending', activeForm: 'Running the checks' }
        ]
      },
      plan: [
        { text: 'Read the handle', state: 'done' },
        { text: 'Make it wider', state: 'current' },
        { text: 'Run the checks', state: 'todo' }
      ]
    },
    { name: 'an empty list', input: { todos: [] }, plan: [] },
    {
      name: 'a step with no words is left out, and one in a state not known is still to do',
      input: { todos: [{ content: '  ', status: 'pending' }, { content: 'Commit', status: 'paused' }, { status: 'completed' }] },
      plan: [{ text: 'Commit', state: 'todo' }]
    },
    { name: 'no list at all', input: { content: 'Commit' }, plan: undefined },
    { name: 'nothing', input: undefined, plan: undefined }
  ]
  for (const { name, input, plan } of todos) it(name, () => expect(planFromTodos(input)).toEqual(plan))

  const codex: { name: string; params: unknown; plan: ReturnType<typeof planFromCodex> }[] = [
    {
      name: "Codex's plan, each step in its state",
      params: {
        threadId: 't',
        turnId: 'u',
        explanation: null,
        plan: [
          { step: 'Find the failing test', status: 'completed' },
          { step: 'Fix it', status: 'inProgress' },
          { step: 'Run the suite', status: 'pending' }
        ]
      },
      plan: [
        { text: 'Find the failing test', state: 'done' },
        { text: 'Fix it', state: 'current' },
        { text: 'Run the suite', state: 'todo' }
      ]
    },
    { name: 'a notification with no plan', params: { threadId: 't', turnId: 'u' }, plan: undefined }
  ]
  for (const { name, params, plan } of codex) it(name, () => expect(planFromCodex(params)).toEqual(plan))
})
