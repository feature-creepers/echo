import { describe, expect, it } from 'vitest'
import { type MoodFacts, moodOf, moodWord } from './mood.ts'

const quiet: MoodFacts = { asleep: false, listening: false, transcribing: false, speaking: false, running: false, voicing: false, tool: undefined }

describe('the mood of the core', () => {
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

describe('the word under the core', () => {
  it.each<[ReturnType<typeof moodOf>, string | undefined, string]>([
    ['idle', undefined, 'Ready'],
    ['working', 'web_search', 'Searching the web'],
    ['working', 'computer_write', 'Changing a file'],
    ['working', 'computer_run', 'Running a command'],
    ['working', 'browser_click', 'Clicking'],
    ['working', 'a_new_tool', 'Working'],
    ['thinking', 'web_search', 'Thinking']
  ])('says %s with %s as %s', (mood, tool, word) => {
    expect(moodWord(mood, tool)).toBe(word)
  })
})
