import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeVoice, openRecognizer, openSpeechDetector, openVoice, SpeechError } from './index.ts'

/** What the engines do before any model is there. With their models, they are tested in round-trip.test.ts. */

const folders: string[] = []
function emptyFolder(): string {
  const created = mkdtempSync(join(tmpdir(), 'speech-test-'))
  folders.push(created)
  return created
}
afterEach(() => {
  for (const created of folders.splice(0)) rmSync(created, { recursive: true, force: true, maxRetries: 5 })
})

describe('an engine whose model set is not installed', () => {
  it.each([
    ['the recogniser', openRecognizer, 'Speech recognition is not downloaded yet.'],
    ['the voice', openVoice, 'Voice is not downloaded yet.'],
    ['the speech detector', openSpeechDetector, 'Speech detection is not downloaded yet.']
  ] as const)('%s says so instead of opening', async (_, open, message) => {
    const failure = await open({ folder: emptyFolder() }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SpeechError)
    expect(failure).toMatchObject({ code: 'not-installed', message })
  })

  it('refuses a silence that is no length of time', async () => {
    await expect(openSpeechDetector({ folder: emptyFolder(), silence: 0 })).rejects.toMatchObject({ code: 'invalid' })
    await expect(openSpeechDetector({ folder: emptyFolder(), silence: Number.NaN })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('the voice, before it is loaded', () => {
  it('names ten styles a person can choose from, each with an identifier that stays', () => {
    const { styles } = describeVoice()

    expect(styles.map((style) => style.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'm1', 'm2', 'm3', 'm4', 'm5'])
    expect(new Set(styles.map((style) => style.name)).size).toBe(10)
    for (const style of styles) expect(style.name).toMatch(/^(Woman|Man), \w/)
  })

  it('speaks English and French among its languages, each named once by a two-letter code', () => {
    const { languages } = describeVoice()

    expect(languages.slice(0, 2)).toEqual(['en', 'fr'])
    expect(languages.length).toBe(31)
    expect(new Set(languages).size).toBe(31)
    for (const language of languages) expect(language).toMatch(/^[a-z]{2}$/)
  })

  it('hands out lists that the caller may change without changing the voice', () => {
    describeVoice().styles.length = 0
    describeVoice().languages.length = 0

    expect(describeVoice().styles.length).toBe(10)
    expect(describeVoice().languages.length).toBe(31)
  })
})
