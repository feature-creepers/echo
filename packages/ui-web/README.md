# @repo/ui-web

The interface for web renderers: catalogue components, the stage, the shell and the inspector. Built so far: first launch, the assistant present with its persona, and settings.

The settings come in two groups that say where each is kept. This computer: General (opening at login, starting in the background, the tray, the data folder), Voice (the models, each personality's voice, aloud or not, pace, speakers), Microphone (the device with its live level, when a pause ends listening, the sounds) and Shortcuts (recorded by pressing them). The assistant, kept by the core: Personalities, Models (the model each AI program answers with, and the one preferred) and Memory (what it knows, to edit or forget, when it sleeps, and the export). Then Updates & about.

What belongs to the device reaches the interface through a `DeviceHost` the app supplies (`device/host.ts`), as speech does through a `SpeechEngine`: reading and changing the device's settings, giving a shortcut new keys, the app's version and its updates. Inside, `useDevice()` gives the settings wherever they are needed: the recorder opens the microphone chosen, the voice plays at the pace and on the speakers chosen, and the keys are the ones set.

Styles are CSS modules beside each component. Colours, sizes and durations come from `@repo/tokens`: the app calls `applyTheme` once, before the first draw.

- **Runs in:** A browser window
- **May import:** `@repo/client`, `@repo/protocol`, `@repo/catalog`, `@repo/tokens`
- **Entry points:** `@repo/ui-web`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
