import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // These tests start real processes, which is slow on some machines, Windows above all.
    testTimeout: 20_000
  }
})
