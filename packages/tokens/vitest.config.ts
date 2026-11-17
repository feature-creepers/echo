import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The test reads the generated stylesheet as text. Left to itself, the test runner hands over every stylesheet empty.
  test: { css: true }
})
