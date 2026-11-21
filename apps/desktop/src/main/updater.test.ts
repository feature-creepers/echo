import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))

const { installsItself } = await import('./updater.ts')

describe('whether a new version installs itself', () => {
  it.each([
    { platform: 'darwin', testFeed: false, signed: true, installs: true, asked: true },
    { platform: 'darwin', testFeed: false, signed: false, installs: false, asked: true },
    { platform: 'darwin', testFeed: true, signed: false, installs: true, asked: false },
    { platform: 'win32', testFeed: false, signed: false, installs: true, asked: false },
    { platform: 'linux', testFeed: false, signed: false, installs: true, asked: false }
  ] as const)('on $platform, signed: $signed, test feed: $testFeed → $installs', async ({ platform, testFeed, signed, installs, asked }) => {
    const signature = vi.fn(async () => signed)
    expect(await installsItself(platform, testFeed, signature)).toBe(installs)
    expect(signature).toHaveBeenCalledTimes(asked ? 1 : 0)
  })
})
