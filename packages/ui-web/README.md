# @repo/ui-web

The interface for web renderers, in React: the shell (title row, screens, side sheet), the stage with the core and its captions, the catalogue's blocks drawn for the web, the library of saved views, the media player, the inspector, and the settings. An app mounts `Shell` and gives it a client from `@repo/client`.

What belongs to the device reaches the interface through what the app supplies: a `DeviceHost` (`src/device/host.ts`) for the device's settings, shortcuts, files, the app's version and its updates, and a `SpeechEngine` (`src/audio/engine.ts`) for recognition and the voice. Left out, the interface works without them.

| Folder          | What it holds                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| `shell/`        | The window: title row, screens, and the side sheet                                       |
| `conversation/` | The stage, the input line, the transcript and the threads                                |
| `view/`         | The renderer of a view, one drawing per block in `view/blocks/`                          |
| `files/`        | File previews, Office documents among them (mammoth, SheetJS, JSZip, loaded when needed) |
| `media/`        | The one player every Media block plays through, and its now-playing control              |
| `library/`      | The library screen and the pinned views                                                  |
| `settings/`     | The settings of this device and of the assistant                                         |
| `inspector/`    | The raw events from the core                                                             |
| `primitives/`   | The app's controls, in its colours                                                       |

Styles are Tailwind classes on the components, with the theme generated from `@repo/tokens`; `src/styles/app.css` is the one stylesheet.

- **Runs in:** A browser window
- **May import:** `@repo/client`, `@repo/protocol`, `@repo/catalog`, `@repo/tokens`
- **Entry points:** `@repo/ui-web`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/ui-web test
```

The tests cover what parses, computes or decides; the few that need a DOM run in jsdom. A screen is checked in the built app.
