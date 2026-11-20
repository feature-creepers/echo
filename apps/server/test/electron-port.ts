/**
 * Electron's port to the app that started a utility process, played by Node's channel to the process that forked
 * this one. Loaded before the core (`node --import`), it lets the tests reach the core as the desktop app does.
 */
const send = process.send?.bind(process)
if (send) {
  Object.assign(process, {
    parentPort: {
      on: (_event: 'message', listener: (event: { data: unknown }) => void) => process.on('message', (data) => listener({ data })),
      postMessage: (message: unknown) => send(message)
    }
  })
}
