import { describe, expect, it } from 'vitest'
import { candidates as darwin, MISSING as darwinMissing } from './darwin.ts'
import { findBrowser, nameOf } from './find.ts'
import { candidates as linux } from './linux.ts'
import { candidates as win32 } from './win32.ts'

/** Each system's file is checked on every system: only one of them is used for real where the tests run. */
describe('where the browsers are', () => {
  it('looks for Microsoft Edge first on Windows, then Google Chrome, where Windows says the program folders are', () => {
    expect(win32('C:\\Users\\Ada', { ProgramFiles: 'D:\\Programs', 'ProgramFiles(x86)': 'D:\\Programs (x86)', LOCALAPPDATA: 'D:\\Local' })).toEqual([
      { name: 'Microsoft Edge', path: 'D:\\Programs (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
      { name: 'Microsoft Edge', path: 'D:\\Programs\\Microsoft\\Edge\\Application\\msedge.exe' },
      { name: 'Microsoft Edge', path: 'D:\\Local\\Microsoft\\Edge\\Application\\msedge.exe' },
      { name: 'Google Chrome', path: 'D:\\Programs\\Google\\Chrome\\Application\\chrome.exe' },
      { name: 'Google Chrome', path: 'D:\\Programs (x86)\\Google\\Chrome\\Application\\chrome.exe' },
      { name: 'Google Chrome', path: 'D:\\Local\\Google\\Chrome\\Application\\chrome.exe' }
    ])
  })

  it('works out the Windows folders when Windows does not say', () => {
    const paths = win32('C:\\Users\\Ada', {}).map((candidate) => candidate.path)
    expect(paths[0]).toBe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
    expect(paths).toContain('C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  })

  it('looks for Google Chrome first on macOS, then Microsoft Edge, then Chromium, in both Applications folders', () => {
    expect(darwin('/Users/ada')).toEqual([
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Google Chrome', path: '/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { name: 'Microsoft Edge', path: '/Users/ada/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
      { name: 'Chromium', path: '/Users/ada/Applications/Chromium.app/Contents/MacOS/Chromium' }
    ])
  })

  it('looks for Google Chrome first on Linux, then Chromium, the Snap last', () => {
    const found = linux()
    expect(found[0]).toEqual({ name: 'Google Chrome', path: '/opt/google/chrome/chrome' })
    expect(found.map((candidate) => candidate.name)).toEqual([
      'Google Chrome',
      'Google Chrome',
      'Google Chrome',
      'Chromium',
      'Chromium',
      'Chromium',
      'Chromium'
    ])
    expect(found.at(-1)?.path).toBe('/snap/bin/chromium')
  })
})

describe('finding the browser', () => {
  const candidates = win32('C:\\Users\\Ada', {})
  const installed =
    (...paths: string[]) =>
    async (path: string) =>
      paths.includes(path)

  it.each([
    ['Edge for all users', ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'], 'Microsoft Edge'],
    [
      'Edge before Chrome when both are there',
      ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
      'Microsoft Edge'
    ],
    ['Chrome for this user only', ['C:\\Users\\Ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'], 'Google Chrome']
  ])('finds %s', async (_case, paths, name) => {
    expect(await findBrowser({ candidates, missing: 'none', exists: installed(...paths) })).toMatchObject({ found: true, name })
  })

  it('says which browsers are needed when none is there', async () => {
    expect(await findBrowser({ candidates: darwin('/Users/ada'), missing: darwinMissing, exists: installed() })).toEqual({
      found: false,
      problem: darwinMissing
    })
  })

  it('takes the browser a developer names, and only when it is there', async () => {
    const override = '/home/ada/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'
    expect(await findBrowser({ candidates, missing: 'none', override, exists: installed(override) })).toEqual({ found: true, name: 'Chromium', path: override })
    expect(await findBrowser({ candidates, missing: 'none', override, exists: installed(candidates[0]?.path ?? '') })).toEqual({
      found: false,
      problem: `There is no browser at ${override}, which ASSISTANT_BROWSER names.`
    })
  })

  it.each([
    ['C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'Microsoft Edge'],
    ['/opt/google/chrome/chrome', 'Google Chrome'],
    ['/usr/bin/chromium-browser', 'Chromium'],
    ['/opt/brave/brave', 'brave']
  ])('names %s %j', (path, name) => {
    expect(nameOf(path)).toBe(name)
  })
})
