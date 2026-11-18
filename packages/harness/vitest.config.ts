import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // These tests start and stop real processes, which is slow on some machines, Windows runners above all:
    // stopping a process tree there can take several seconds, and it happens in the hooks after each test.
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
