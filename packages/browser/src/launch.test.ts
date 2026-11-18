import { describe, expect, it } from 'vitest'
import { IGNORED_DEFAULT_ARGUMENTS, launchOptions } from './launch.ts'

describe('how the browser is started', () => {
  it('keeps what protected video needs, and the window', () => {
    // Widevine is fetched as a component: neither its update nor the network it needs may be switched off.
    expect(IGNORED_DEFAULT_ARGUMENTS).toContain('--disable-component-update')
    expect(IGNORED_DEFAULT_ARGUMENTS).toContain('--disable-background-networking')
    expect(IGNORED_DEFAULT_ARGUMENTS).toContain('--enable-automation')
    expect(launchOptions({ executablePath: '/opt/google/chrome/chrome', headless: false, sandbox: true })).toMatchObject({
      headless: false,
      viewport: null,
      chromiumSandbox: true
    })
  })
})
