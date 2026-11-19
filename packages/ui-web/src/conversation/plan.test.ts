import type { Exchange, PlanStep } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { doingOf, planCount, planLine } from './plan.ts'

const step = (text: string, state: PlanStep['state']): PlanStep => ({ text, state })

describe('where a plan stands', () => {
  const cases: { name: string; plan: PlanStep[] | undefined; line: string | undefined; count?: string }[] = [
    { name: 'no plan', plan: undefined, line: undefined },
    { name: 'an empty plan', plan: [], line: undefined },
    {
      name: 'the step under way',
      plan: [step('Read the code', 'done'), step('Fix the test', 'current'), step('Run the checks', 'todo')],
      line: 'Step 2 of 3 · Fix the test',
      count: '1 of 3 done'
    },
    {
      name: 'the next step to do, when none is under way',
      plan: [step('Read the code', 'done'), step('Fix the test', 'todo')],
      line: 'Step 2 of 2 · Fix the test',
      count: '1 of 2 done'
    },
    { name: 'every step done', plan: [step('Read', 'done'), step('Fix', 'done')], line: 'All 2 steps done', count: '2 of 2 done' },
    { name: 'its one step done', plan: [step('Read', 'done')], line: 'Its one step is done', count: '1 of 1 done' }
  ]
  for (const { name, plan, line, count } of cases)
    it(name, () => {
      expect(planLine(plan)).toBe(line)
      if (plan && count !== undefined) expect(planCount(plan)).toBe(count)
    })
})

const line = (turn: string, thread: string | undefined, said: string, outcome: Exchange['outcome'], plan?: PlanStep[]): Exchange => ({
  turn,
  at: '2026-11-19T12:00:00.000Z',
  persona: 'persona',
  said,
  replied: '',
  outcome,
  ...(thread === undefined ? {} : { thread }),
  ...(plan === undefined ? {} : { plan })
})

describe('what a thread at work is doing', () => {
  it.each([
    { name: 'nothing, with no line of its own', lines: [line('1', 'other', 'Fix it', 'running')], doing: undefined },
    { name: 'nothing, when its lines are answered', lines: [line('1', 'project', 'Fix it', 'done')], doing: undefined },
    { name: 'the request it answers', lines: [line('1', 'project', ' Fix the sheet ', 'running')], doing: 'Fix the sheet' },
    {
      name: 'its latest request still running',
      lines: [line('1', 'project', 'First', 'running'), line('2', 'project', 'Second', 'running'), line('3', 'project', 'Third', 'done')],
      doing: 'Second'
    },
    {
      name: 'where its plan stands, before the request',
      lines: [line('1', 'project', 'Fix it', 'running', [step('Read', 'done'), step('Fix', 'current')])],
      doing: 'Step 2 of 2 · Fix'
    },
    { name: 'nothing, for a request of no words', lines: [line('1', 'project', '  ', 'running')], doing: undefined }
  ])('says $name', ({ lines, doing }) => {
    expect(doingOf('project', lines)).toBe(doing)
  })
})
