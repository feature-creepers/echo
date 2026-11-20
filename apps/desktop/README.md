# @repo/desktop

The desktop app for Windows, macOS and Linux, built with Electron. It starts the core (`@repo/server`) as a utility process, connects to it as any client does, through `@repo/client`, and draws the interface from `@repo/ui-web`. The speech engines (`@repo/speech`) run in a utility process of their own.

- **Runs in:** Electron. The main process and the preload script are Node; the window is a sandboxed browser page with no access to Node
- **May import:** `@repo/client`, `@repo/ui-web`, `@repo/speech`, `@repo/models` and the contracts. Never `@repo/core` or an adapter
- **Entry points:** `src/main/index.ts` (main process), `src/preload/index.ts` (the bridge, typed in `bridge.ts`), `src/renderer/index.html` (the window). `electron.vite.config.ts` also builds the core and the speech service beside the main process: `out/main/core.js`, `out/main/speech.js`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Running it

```bash
pnpm --filter @repo/desktop dev          # the app from the sources, rebuilt as you edit
pnpm --filter @repo/desktop build        # into out/
pnpm --filter @repo/desktop start        # the built app
pnpm --filter @repo/desktop self-check   # what a first launch does, with no window: prints the outcome and quits
pnpm --filter @repo/desktop test
```

`self-check` starts the core, connects to it, reads a new user's settings, names a persona and reads the change back, in a temporary folder of its own. It exits with code 1 when any of that failed. CI runs it on the three systems. On Linux without Chromium's sandbox helper or a display, run it as CI does:

```bash
xvfb-run -a pnpm --filter @repo/desktop exec electron . --self-check --no-sandbox
```

If the terminal belongs to another Electron app (an editor, for instance), unset `ELECTRON_RUN_AS_NODE` first.

| Option              | What it does                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--hidden`          | Start out of sight, in the tray. The app is started this way at login                                                                                              |
| `--talk`            | When the app already runs: bring it forward and start listening. A desktop shortcut bound to it stands in for the global one where the system refuses it (Wayland) |
| `--stop-everything` | When the app already runs: stop everything the assistant does. Not running, the app quits at once                                                                  |
| `--self-check`      | See above                                                                                                                                                          |

## Where it keeps things

The data folder is `%APPDATA%\Echo`, `~/Library/Application Support/Echo` or `~/.config/Echo`. A build run from the sources uses the same path followed by ` (development)`, so trying a change never touches real data. Inside it: the core's data in `core/`, the speech models in `models/`, this device's settings in `settings.json`, and its identifier in `device-id`. Deleting the folder brings back the first launch.

## Packaging and releases

`build/stage.ts` lays out in `stage/` what is packaged: the built program, the app's icons, a manifest naming the GitHub repository updates come from, `playwright-core`, and `sherpa-onnx-node` with its native part for the target system, fetched from the registry. `build/electron-builder.yml` then makes the packages from it. A package for another system can be made from this one.

```bash
pnpm build
pnpm --filter @repo/desktop package:win     # or package:mac, package:linux, into release/
```

A tag `v<version>`, matching `version` in this folder's `package.json`, runs `.github/workflows/release.yml`: it packages the app on each system and uploads the packages and the update manifests to a draft GitHub release. Publishing the draft rolls the update out; electron-updater finds it within four hours, or at once from Settings. Nothing is signed yet, so macOS cannot install an update by itself: there the app announces the new version with its release page. A copy unpacked from the Windows ZIP does not update either.

To try an update without publishing one, serve a folder holding a newer package and its `latest*.yml` over HTTP and start the app with `ECHO_UPDATE_FEED=http://127.0.0.1:8000`.
