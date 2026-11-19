import type { PlanStep } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { planCount, planLine } from './plan.ts'

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
