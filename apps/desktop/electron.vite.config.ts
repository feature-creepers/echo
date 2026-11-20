import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/**
 * The core is a program of its own. The app ships it beside its main process and starts it at launch,
 * so it is built here as a second entry: out/main/core.js.
 */
const coreEntry = fileURLToPath(import.meta.resolve('@repo/server/main'))

/** The speech engines run in a process of their own too: out/main/speech.js. */
const speechEntry = fileURLToPath(import.meta.resolve('@repo/speech/process'))

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/**
 * The app registrations of the account providers, as the variables set when the app is built say: written into the
 * core, so the build's configuration decides, never the repository's or the environment the app later runs in. A
 * variable left unset leaves its provider out of this build.
 */
const REGISTRATIONS = ['ECHO_GOOGLE_CLIENT_ID', 'ECHO_GOOGLE_CLIENT_SECRET', 'ECHO_MICROSOFT_CLIENT_ID']
const registrations = Object.fromEntries(REGISTRATIONS.map((name) => [`process.env.${name}`, JSON.stringify(process.env[name] ?? '')]))

/**
 * The development server runs React's refresh preamble as an inline script and reloads the page over a WebSocket.
 * Only there does the page's security policy allow them: the built page runs its own files and nothing else.
 */
const developmentPolicy: Plugin = {
  name: 'development-content-security-policy',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'self'", "connect-src 'self' ws://localhost:*")
}

export default defineConfig({
  main: {
    define: registrations,
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
    plugins: [react(), tailwindcss(), developmentPolicy],
    build: {
      // Every asset stays a file of the app: the page's security policy loads nothing from a data: address,
      // which is what small assets would otherwise become (the microphone's audio worklet among them).
      assetsInlineLimit: 0,
      rollupOptions: { input: { index: here('src/renderer/index.html') } }
    }
  }
})
