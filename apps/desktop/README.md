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

The app also takes these options:

| Option         | What it does                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--hidden`     | Start out of sight, in the tray. The app is started this way at login                                                                                               |
| `--talk`       | When the app already runs: bring it forward and start listening. Bound to a desktop shortcut, it stands in for the global one where the system refuses it (Wayland) |
| `--self-check` | See above                                                                                                                                                           |

## Where it keeps things

| What                                   | Where                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| The user's data, written by the core   | `core/store.sqlite` in the app's data folder                                               |
| The identifier of this device          | `device-id` in the same folder                                                             |
| This device's settings                 | `settings.json` in the same folder: microphone, speakers, voice, shortcuts, start, updates |
| The app's data folder                  | `%APPDATA%\Echo`, `~/Library/Application Support/Echo` or `~/.config/Echo`                 |
| The same, for a build run from sources | The same path followed by ` (development)`, so trying a change never touches real data     |

Deleting the data folder brings back the first launch.

## Packaging

`build/stage.ts` lays out what is packaged in `stage/`: the built program, a manifest, and the native part of the speech library for the target system, fetched from the registry. `build/electron-builder.yml` then makes the package from it. A package for another system can be made from this one.

```bash
pnpm build
pnpm --filter @repo/desktop package:win     # release/Echo-<version>-win.zip
pnpm --filter @repo/desktop package:linux   # release/Echo-<version>.AppImage
pnpm --filter @repo/desktop package:mac     # on a Mac: release/Echo-<version>-arm64.dmg
```

CI packages the app on each system on every push, with the Windows installer, and keeps the packages for download on the run's page. Nothing is signed yet, so Windows and macOS warn before the first start.

`build/stage.ts` writes into the staged manifest the GitHub repository the updates come from: the one a GitHub Actions run belongs to, else this clone's `origin`. The packager writes it into the package (`resources/app-update.yml`).

## Releases and updates

A release is cut by a tag:

1. Set the new version in `package.json` (this file's folder), for instance `0.2.0`, and commit it.
2. Tag that commit `v0.2.0` and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow (`.github/workflows/release.yml`) checks that the tag is the version, runs the checks, then packages the app on Windows, macOS and Linux and uploads everything to a draft release named after the version: the installers, and the manifests the updater reads (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`).
4. Read the draft on the Releases page, write its notes, and publish it. Installed copies only see published releases: from then on they find it within four hours, or at once from Settings, Updates & about.

The app looks 20 seconds after it starts, then every four hours. With "Update automatically" on (the default), it downloads in the background and installs when the app quits, so an update never interrupts a conversation; the user can also restart for it at once. Off, it tells the user and waits.

Without signing:

| System  | Updates                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | Work, from the installer (NSIS). A copy unpacked from the ZIP cannot update itself and says so                                                 |
| macOS   | Do not install: macOS only accepts an update signed by the same developer. The app announces the new version with a button to its release page |
| Linux   | Work for the AppImage                                                                                                                          |

To try an update without publishing one, serve a folder holding a newer package and its `latest*.yml` over HTTP and start the app with `ECHO_UPDATE_FEED=http://127.0.0.1:8000`. A copy run from the sources then checks and downloads too (an AppImage update also needs `APPIMAGE` set to a file to replace).

## How it is put together

| Part               | Role                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main`         | The main process: starts the core (`core-process.ts`), opens the window, answers the bridge; keeps this device's settings (`device-settings.ts`), the global shortcut, the tray, opening at login and the updates |
| `src/preload`      | The bridge: the only things the window may ask of the app (`bridge.ts`)                                                                                                                                           |
| `src/renderer`     | The window: opens a session with the core through the bridge and mounts `@repo/ui-web`. Its security policy runs the app's scripts only, and lets views load pictures and play media from https addresses         |
| `out/main/core.js` | The core's program (`@repo/server`), built beside the main process and run as a utility process                                                                                                                   |
