import type { Stance } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { type MoodFacts, moodOf, moodWord } from './mood.ts'

const quiet: MoodFacts = { asleep: false, listening: false, transcribing: false, speaking: false, running: false, voicing: false, tool: undefined }

describe('the mood of the eye', () => {
  it.each<[string, Partial<MoodFacts>, ReturnType<typeof moodOf>]>([
    ['ready with nothing going on', {}, 'idle'],
    ['asleep with nothing going on', { asleep: true }, 'asleep'],
    ['awake to listen while asleep', { asleep: true, listening: true }, 'listening'],
    ['awake to answer while asleep', { asleep: true, running: true }, 'thinking'],
    ['listening over everything else', { listening: true, speaking: true, running: true }, 'listening'],
    ['thinking while what was said is written out', { transcribing: true }, 'thinking'],
    ['speaking while a sentence is heard', { speaking: true, running: true, tool: 'web_search' }, 'speaking'],
    ['working while a tool works for the turn', { running: true, tool: 'web_search' }, 'working'],
    ['thinking while the turn is routed', { running: true, tool: 'thread_open' }, 'thinking'],
    ['thinking while the voice is about to speak', { voicing: true }, 'thinking']
  ])('is %s', (_name, facts, mood) => {
    expect(moodOf({ ...quiet, ...facts })).toBe(mood)
  })
})

describe('the word under the eye', () => {
  it.each<[ReturnType<typeof moodOf>, string | undefined, Stance, string]>([
    ['idle', undefined, 'critical', 'Ready'],
    ['idle', undefined, 'accommodating', 'At your service'],
    ['asleep', undefined, 'critical', 'Standing by'],
    ['asleep', undefined, 'accommodating', 'Resting'],
    ['working', 'web_search', 'critical', 'Searching the web'],
    ['working', 'web_search', 'accommodating', 'Searching the web'],
    ['working', 'computer_write', 'critical', 'Changing a file'],
    ['working', 'computer_run', 'critical', 'Running a command'],
    ['working', 'browser_click', 'critical', 'Clicking'],
    ['working', 'a_new_tool', 'critical', 'Working'],
    ['working', 'a_new_tool', 'accommodating', 'On it'],
    ['thinking', 'web_search', 'critical', 'Thinking']
  ])('says %s with %s, in the %s stance, as %s', (mood, tool, stance, word) => {
    expect(moodWord(mood, tool, stance)).toBe(word)
  })
})
