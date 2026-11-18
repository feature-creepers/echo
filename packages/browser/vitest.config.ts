import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The tests against a real browser start and stop it, which takes seconds on a slow machine.
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
