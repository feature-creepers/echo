import type { TopicAnswers } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { type Stepped, shownOf, stepFrom } from './versions.ts'

/** A topic whose answers read so far are these, the latest first. */
const topic = (...answers: string[]): TopicAnswers => ({
  topic: { id: 'trip', title: 'Trip', at: '2026-11-22T09:00:00.000Z', answers: answers.length },
  answers: answers.map((id) => ({ id, at: '2026-11-22T09:00:00.000Z', views: [] }))
})

describe('the version a topic shows', () => {
  it.each<[string, Stepped | undefined, { at: number; way: number }]>([
    ['its latest answer, until the person steps', undefined, { at: 0, way: 0 }],
    ['the earlier answer they stepped to', { latest: 'c', shown: 'a', way: 1 }, { at: 2, way: 1 }],
    ['the later answer they stepped back to', { latest: 'c', shown: 'b', way: -1 }, { at: 1, way: -1 }],
    ['its latest answer again once a new one arrived', { latest: 'b', shown: 'a', way: 1 }, { at: 0, way: 0 }],
    ['its latest answer when the one they stepped to is gone', { latest: 'c', shown: 'moved', way: 1 }, { at: 0, way: 0 }]
  ])('is %s', (_case, stepped, shown) => {
    expect(shownOf(topic('c', 'b', 'a'), stepped)).toEqual(shown)
  })
})

describe('the version a topic that asks shows', () => {
  const question = { id: 'q', title: 'Go ahead?', spec: { root: 'a', elements: { a: { type: 'Questions', props: {}, children: [] } } } }
  const asking = (progress: TopicAnswers['topic']['progress']): TopicAnswers => {
    const one = topic('c', 'b', 'a')
    return {
      topic: { ...one.topic, ...(progress === undefined ? {} : { progress }) },
      answers: one.answers.map((answer) => (answer.id === 'b' ? { ...answer, views: [question] } : answer))
    }
  }
  it.each<[string, TopicAnswers, Stepped | undefined, number]>([
    ['the answer that asks, though a later request was passed on behind it', asking('asks'), undefined, 1],
    ['the answer the person stepped to, all the same', asking('asks'), { latest: 'c', shown: 'a', way: 1 }, 2],
    ['its latest answer, once it no longer asks', asking('working'), undefined, 0]
  ])('is %s', (_case, one, stepped, at) => {
    expect(shownOf(one, stepped).at).toBe(at)
  })
})

describe('a step', () => {
  it.each<[string, number, 1 | -1, number | undefined]>([
    ['leads to the answer before', 0, 1, 1],
    ['leads back to the answer after', 2, -1, 1],
    ['stops at the first answer', 2, 1, undefined],
    ['stops at the latest answer', 0, -1, undefined]
  ])('%s', (_case, at, way, to) => {
    expect(stepFrom(at, way, 3)).toBe(to)
  })
})
