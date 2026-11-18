import type { TurnId } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { attendedView } from './attention.ts'

const turn = (id: string) => id as TurnId

/** The stream, newest first: two views of the answer under way, one of an earlier topic, one read on opening. */
const STREAM = [{ id: 'chart', turn: turn('t2') }, { id: 'table', turn: turn('t2') }, { id: 'recipe', turn: turn('t1') }, { id: 'opened' }]

describe('the view the core looks at', () => {
  it.each([
    { case: 'while it talks about an answer, the newest view of it', spoken: 't2', answering: undefined, arrived: [], looks: 'chart' },
    { case: 'while it talks about an earlier topic, that topic’s view', spoken: 't1', answering: undefined, arrived: [], looks: 'recipe' },
    { case: 'while an answer is under way, the view that just arrived for it', spoken: undefined, answering: 't2', arrived: ['table'], looks: 'table' },
    { case: 'talking wins over what just arrived', spoken: 't1', answering: 't2', arrived: ['chart'], looks: 'recipe' },
    { case: 'a view read on opening is not looked at by itself', spoken: undefined, answering: 't2', arrived: [], looks: undefined },
    { case: 'talking about a turn with no view', spoken: 't9', answering: undefined, arrived: [], looks: undefined },
    { case: 'nothing under way', spoken: undefined, answering: undefined, arrived: ['chart'], looks: undefined }
  ])('$case', ({ spoken, answering, arrived, looks }) => {
    expect(attendedView(STREAM, spoken === undefined ? undefined : turn(spoken), answering === undefined ? undefined : turn(answering), arrived)).toBe(looks)
  })
})
