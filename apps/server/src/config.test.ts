import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigError, firstLine, readConfig } from './config.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('the configuration', () => {
  it.each([
    { args: ['--data', 'folder'], token: 'secret', read: { token: 'secret', data: 'folder', exitWithParent: false } },
    { args: ['--data', 'folder', '--exit-with-parent'], token: 'secret', read: { token: 'secret', data: 'folder', exitWithParent: true } }
  ])('reads $args with a token', async ({ args, token, read }) => {
    expect(await readConfig(args, Promise.resolve(token))).toEqual(read)
  })

  it.each([
    { case: 'no token, the input ended', args: ['--data', 'folder'], token: undefined, says: 'No token was given.' },
    { case: 'an empty token', args: ['--data', 'folder'], token: '', says: 'The token given is empty.' },
    { case: "no folder for the user's data", args: [], token: 'secret', says: '--data' },
    { case: 'an option it does not know', args: ['--data', 'folder', '--nonsense'], token: 'secret', says: 'nonsense' }
  ])('refuses $case, and says why', async ({ args, token, says }) => {
    const reading = readConfig(args, Promise.resolve(token))
    await expect(reading).rejects.toBeInstanceOf(ConfigError)
    await expect(reading).rejects.toThrow(says)
  })

  it('gives up on a token not given within 15 seconds', async () => {
    vi.useFakeTimers()
    let refused: unknown
    const reading = readConfig(['--data', 'folder'], new Promise(() => undefined)).catch((error: unknown) => (refused = error))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(refused).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await reading
    expect(refused).toBeInstanceOf(ConfigError)
    expect(refused).toMatchObject({ message: 'No token was given.' })
  })
})

describe('the first line of standard input', () => {
  it.each([
    { written: ['token\n'], line: 'token' },
    { written: ['tok', 'en\nwhat follows'], line: 'token' },
    { written: ['token\r\n'], line: 'token' },
    { written: ['token'], line: 'token' },
    { written: ['\n'], line: '' },
    { written: [], line: undefined }
  ])('reads $written as $line', async ({ written, line }) => {
    const input = new PassThrough()
    const reading = firstLine(input)
    for (const chunk of written) input.write(chunk)
    input.end()
    expect(await reading).toBe(line)
  })
})
