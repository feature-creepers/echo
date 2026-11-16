# @repo/desktop

The desktop app for Windows, macOS and Linux, built with Electron. It is a client of the core on this device: it starts the core as a separate process, connects to it through `@repo/client`, and draws the interface from `@repo/ui-web`.

- **Runs in:** Electron. The main process and the preload script are Node; the window is a browser page with no access to Node
- **May import:** `@repo/client`, `@repo/ui-web`, the contracts, `@repo/speech` and `@repo/models`. Never `@repo/core` or an adapter

## Running it

```bash
pnpm --filter @repo/desktop dev          # the app, rebuilt as you edit
pnpm --filter @repo/desktop build        # into out/
pnpm --filter @repo/desktop start        # the built app
pnpm --filter @repo/desktop self-check   # start the core, connect, print the outcome, quit
```

`self-check` exits with code 1 when the app and its core could not connect. CI runs it on the three systems.

On Linux, Electron refuses to start when Chromium's sandbox helper is not set up, which is the case on most development machines and on CI. Add `--no-sandbox` to run it there, and a display such as `xvfb-run` when the machine has none:

```bash
xvfb-run -a pnpm --filter @repo/desktop exec electron . --self-check --no-sandbox
```

If the terminal you start it from belongs to another Electron app (an editor, for instance), unset `ELECTRON_RUN_AS_NODE` first.

## How it is put together

| Part               | Role                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `src/main`         | The main process: starts the core (`core-process.ts`), opens the window, answers the bridge     |
| `src/preload`      | The bridge: the only things the window may ask of the app (`bridge.ts`)                         |
| `src/renderer`     | The window: mounts `@repo/ui-web`                                                               |
| `out/main/core.js` | The core's program (`@repo/server`), built beside the main process and run as a utility process |
