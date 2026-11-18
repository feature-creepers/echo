import type { Exchange, Step } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { cutInput, cutText, fitThread } from './fit.ts'

const exchange = (turn: string, said = 'Work on it.'): Exchange => ({
  turn,
  at: '2026-11-18T17:00:00.000Z',
  persona: 'p1',
  thread: 'th1',
  said,
  replied: 'Done.',
  outcome: 'done'
})
const step = (turn: string, call: string, output = 'ok', input: unknown = { command: 'pnpm check' }): Step => ({
  call,
  turn,
  thread: 'th1',
  tool: 'Bash',
  input,
  output,
  at: '2026-11-18T17:00:00.000Z',
  ended: '2026-11-18T17:00:01.000Z'
})

describe('cutting a text', () => {
  it.each([
    ['short', 'abc', 5, 'abc'],
    ['exactly at the limit', 'abcde', 5, 'abcde'],
    ['over the limit', 'abcdefg', 5, 'abcde\n[…cut]']
  ])('%s', (_name, text, most, expected) => {
    expect(cutText(text, most)).toBe(expected)
  })
})

describe('cutting what a tool was given', () => {
  it.each([
    ['a long string', 'x'.repeat(10), 'xxxx\n[…cut]'],
    ['a number', 42, 42],
    ['nothing', null, null],
    ['an object, keeping its keys', { command: 'y'.repeat(10), timeout: 5 }, { command: 'yyyy\n[…cut]', timeout: 5 }],
    ['an array within', { paths: ['abc', 'z'.repeat(9)] }, { paths: ['abc', 'zzzz\n[…cut]'] }]
  ])('%s', (_name, input, expected) => {
    expect(cutInput(input, 4)).toEqual(expected)
  })
})

describe('fitting a thread to one message', () => {
  it('keeps a small thread whole', () => {
    const fitted = fitThread([exchange('t1'), exchange('t2')], [step('t1', 'c1'), step('t2', 'c2')])
    expect(fitted.earlier).toBe(0)
    expect(fitted.exchanges.map((one) => one.turn)).toEqual(['t1', 't2'])
    expect(fitted.steps.map((one) => one.call)).toEqual(['c1', 'c2'])
  })

  it('cuts long outputs and inputs of each step', () => {
    const fitted = fitThread([exchange('t1')], [step('t1', 'c1', 'o'.repeat(50_000), { content: 'i'.repeat(50_000) })])
    const [shown] = fitted.steps
    expect(shown?.output?.length).toBeLessThan(5_000)
    expect(JSON.stringify(shown?.input).length).toBeLessThan(5_000)
  })

  it('leaves out the oldest requests, with their steps, past the budget', () => {
    const exchanges = Array.from({ length: 300 }, (_, index) => exchange(`t${index}`))
    const steps = exchanges.flatMap((one) => Array.from({ length: 10 }, (_, index) => step(one.turn, `${one.turn}-${index}`, 'o'.repeat(4_000))))
    const fitted = fitThread(exchanges, steps)
    expect(fitted.earlier).toBeGreaterThan(0)
    expect(fitted.exchanges.length + fitted.earlier).toBe(300)
    expect(fitted.exchanges.at(-1)?.turn).toBe('t299')
    expect(JSON.stringify(fitted).length).toBeLessThan(700_000)
    const kept = new Set(fitted.exchanges.map((one) => one.turn))
    expect(fitted.steps.every((one) => kept.has(one.turn))).toBe(true)
  })

  it('always keeps the latest request, however heavy', () => {
    const fitted = fitThread([exchange('t1'), exchange('t2', 'w'.repeat(2_000))], [], 100)
    expect(fitted.exchanges.map((one) => one.turn)).toEqual(['t2'])
    expect(fitted.earlier).toBe(1)
  })
})
