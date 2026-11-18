import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The tests against the real desktop start a helper that compiles its bridge to the system first.
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
