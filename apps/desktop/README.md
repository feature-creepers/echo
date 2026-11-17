# @repo/desktop

The desktop app for Windows, macOS and Linux, built with Electron. It is a client of the core on this device: it starts the core as a separate process, connects to it through `@repo/client`, and draws the interface from `@repo/ui-web`.

- **Runs in:** Electron. The main process and the preload script are Node; the window is a browser page with no access to Node
- **May import:** `@repo/client`, `@repo/ui-web`, the contracts, `@repo/speech` and `@repo/models`. Never `@repo/core` or an adapter

## Running it

```bash
pnpm --filter @repo/desktop dev          # the app, rebuilt as you edit
pnpm --filter @repo/desktop build        # into out/
pnpm --filter @repo/desktop start        # the built app
pnpm --filter @repo/desktop self-check   # do what a first launch does, with no window, print the outcome, quit
pnpm --filter @repo/desktop package      # package the built app for this system, into release/
```

`self-check` starts the core, connects to it, reads a new user's settings, names a persona and reads the change back. It exits with code 1 when any of that failed. It runs in a temporary folder of its own and never touches the user's data. CI runs it on the three systems.

On Linux, Electron refuses to start when Chromium's sandbox helper is not set up, which is the case on most development machines and on CI. Add `--no-sandbox` to run it there, and a display such as `xvfb-run` when the machine has none:

```bash
xvfb-run -a pnpm --filter @repo/desktop exec electron . --self-check --no-sandbox
```

If the terminal you start it from belongs to another Electron app (an editor, for instance), unset `ELECTRON_RUN_AS_NODE` first.

## Where it keeps things

| What                                   | Where                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| The user's data, written by the core   | `core/store.sqlite` in the app's data folder                                           |
| The identifier of this device          | `device-id` in the same folder                                                         |
| The app's data folder                  | `%APPDATA%\Echo`, `~/Library/Application Support/Echo` or `~/.config/Echo`             |
| The same, for a build run from sources | The same path followed by ` (development)`, so trying a change never touches real data |

Deleting the data folder brings back the first launch.

## Packaging

`build/electron-builder.yml` says how. The product's name and version come from `package.json` (`productName`, `version`).

```bash
pnpm build
pnpm --filter @repo/desktop package                  # for the system you are on
pnpm --filter @repo/desktop package --win zip --x64  # a Windows build from macOS or Linux
```

The Windows installer can only be built on Windows; the ZIP builds anywhere. Nothing is signed yet, so Windows and macOS warn before the first start.

## How it is put together

| Part               | Role                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `src/main`         | The main process: starts the core (`core-process.ts`), opens the window, answers the bridge     |
| `src/preload`      | The bridge: the only things the window may ask of the app (`bridge.ts`)                         |
| `src/renderer`     | The window: opens a session with the core through the bridge and mounts `@repo/ui-web`          |
| `out/main/core.js` | The core's program (`@repo/server`), built beside the main process and run as a utility process |
