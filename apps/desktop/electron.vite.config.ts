import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

/**
 * The core is a program of its own. The app ships it beside its main process and starts it at launch,
 * so it is built here as a second entry: out/main/core.js.
 */
const coreEntry = fileURLToPath(import.meta.resolve('@repo/server/main'))

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: here('src/main/index.ts'), core: coreEntry } }
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
      rollupOptions: { input: { index: here('src/renderer/index.html') } }
    }
  }
})
