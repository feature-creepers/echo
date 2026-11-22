import { asksSomething, type TopicAnswers } from '@repo/protocol'
import { useCallback, useRef, useState } from 'react'

/**
 * The answer of a topic the person stepped to. It holds while the topic's latest answer is the same: a new answer
 * shows itself.
 */
export interface Stepped {
  latest: string
  shown: string
  /** Which way they stepped to it: 1 to an earlier answer, -1 to a later one. */
  way: 1 | -1
}

/**
 * Which answer of a topic is shown, counted from the latest, and which way the person came to it, if they stepped.
 * Until they do, it is the latest, or, while the topic asks them something, the answer that asks: a request passed on
 * behind an approval must not hide it.
 */
export function shownOf(topic: TopicAnswers, stepped: Stepped | undefined): { at: number; way: 1 | -1 | 0 } {
  if (stepped !== undefined && stepped.latest === topic.answers[0]?.id) {
    const at = topic.answers.findIndex((answer) => answer.id === stepped.shown)
    if (at >= 0) return { at, way: stepped.way }
  }
  const asking = topic.topic.progress === 'asks' ? topic.answers.findIndex((answer) => answer.views.some(asksSomething)) : -1
  return { at: Math.max(asking, 0), way: 0 }
}

/** Where a step leads from the answer shown, counted from the latest, or nothing when there is no answer that way. */
export function stepFrom(at: number, way: 1 | -1, answers: number): number | undefined {
  const to = at + way
  return to < 0 || to >= answers ? undefined : to
}

/**
 * The version each topic shows (docs/SPEC.md, section 13.2): its latest answer, until the person steps to an earlier
 * one. Stepping past the answers read so far reads the ones before them first.
 */
export function useVersions(topics: readonly TopicAnswers[], earlier: (topic: string) => Promise<void>) {
  const [stepped, setStepped] = useState<Readonly<Record<string, Stepped>>>({})
  const current = useRef({ topics, stepped })
  current.current = { topics, stepped }

  const step = useCallback(
    async (id: string, way: 1 | -1) => {
      const find = () => current.current.topics.find((one) => one.topic.id === id)
      const topic = find()
      if (!topic) return
      const to = stepFrom(shownOf(topic, current.current.stepped[id]).at, way, topic.topic.answers)
      if (to === undefined) return
      if (to >= topic.answers.length) await earlier(id).catch(() => undefined)
      const read = find()
      const [latest, next] = [read?.answers[0], read?.answers[to]]
      if (latest && next) setStepped((was) => ({ ...was, [id]: { latest: latest.id, shown: next.id, way } }))
    },
    [earlier]
  )
  /** Show one answer of a topic, by what names it: the one a line of its story stands for. */
  const show = useCallback((id: string, answer: string) => {
    const topic = current.current.topics.find((one) => one.topic.id === id)
    const latest = topic?.answers[0]
    const to = topic?.answers.findIndex((one) => one.id === answer) ?? -1
    if (!topic || !latest || to < 0) return
    const from = shownOf(topic, current.current.stepped[id]).at
    setStepped((was) => ({ ...was, [id]: { latest: latest.id, shown: answer, way: to >= from ? 1 : -1 } }))
  }, [])
  return { stepped, step, show }
}

/** The versions the topics show, as the main screen and the side panel share them. */
export type Versions = ReturnType<typeof useVersions>
