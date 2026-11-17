# @repo/ui-web

The interface for web renderers: the catalogue's blocks drawn for the web, the stage, the shell and the inspector. Built so far: first launch; the main screen, with the core, its caption, aside cards and the view in one centred column; the side sheet over the stage (pinned widgets, transcript, threads, inspector); the library of saved widgets; the app's one media player and its now-playing control; and settings, including the Memory section.

The settings come in two groups that say where each is kept. This computer: General (opening at login, starting in the background, the tray, the data folder), Voice (the models, each personality's voice, aloud or not, pace, speakers), Microphone (the device with its live level, when a pause ends listening, the sounds) and Shortcuts (recorded by pressing them). The assistant, kept by the core: Personalities, Models (the model each AI program answers with, and the one preferred) and Memory (what it knows, to edit or forget, when it sleeps, and the export). Then Updates & about.

What belongs to the device reaches the interface through a `DeviceHost` the app supplies (`device/host.ts`), as speech does through a `SpeechEngine`: reading and changing the device's settings, giving a shortcut new keys, the app's version and its updates. Inside, `useDevice()` gives the settings wherever they are needed: the recorder opens the microphone chosen, the voice plays at the pace and on the speakers chosen, and the keys are the ones set.

| Folder          | What it holds                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `view/`         | The renderer of a view, one drawing per block in `view/blocks/`, the stage's view and the aside cards     |
| `media/`        | The player every Media block plays through (`player.ts`, tested without a DOM), its provider, now playing |
| `library/`      | The library screen, a saved widget opened, the pinned list, and the bookmark on every view                |
| `shell/`        | The window: title row, screens, and the side sheet                                                        |
| `conversation/` | The stage, the input line, the transcript and the threads                                                 |
| `inspector/`    | The raw events from the core                                                                              |

Styles are Tailwind classes on the components, with the theme generated from `@repo/tokens`; `styles/app.css` is the one stylesheet.

- **Runs in:** A browser window
- **May import:** `@repo/client`, `@repo/protocol`, `@repo/catalog`, `@repo/tokens`
- **Entry points:** `@repo/ui-web`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
