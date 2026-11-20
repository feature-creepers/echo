import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test starts a worker thread, and the real model takes seconds to load on a slow machine.
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
