import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

/**
 * The core is a program of its own. The app ships it beside its main process and starts it at launch,
 * so it is built here as a second entry: out/main/core.js.
 */
const coreEntry = fileURLToPath(import.meta.resolve('@repo/server/main'))

/** The speech engines run in a process of their own too: out/main/speech.js. */
const speechEntry = fileURLToPath(import.meta.resolve('@repo/speech/process'))

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: here('src/main/index.ts'), core: coreEntry, speech: speechEntry } }
    }
  },
  preload: {
    build: {
      // A sandboxed window only loads a preload script in the CommonJS format.
      rollupOptions: { input: { index: here('src/preload/index.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    root: here('src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      // Every asset stays a file of the app: the page's security policy loads nothing from a data: address,
      // which is what small assets would otherwise become (the microphone's audio worklet among them).
      assetsInlineLimit: 0,
      rollupOptions: { input: { index: here('src/renderer/index.html') } }
    }
  }
})
