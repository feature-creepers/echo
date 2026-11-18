# @repo/client

Client logic with no interface: the connection to a core, the state derived from its events (settings, conversation, harnesses, view, memory and whether the assistant is asleep, the library of saved widgets), speech playback, and the memory as Markdown. Shared by the desktop app and, later, the phone app.

It also holds the settings of a device (`device/settings.ts`): their shape, their defaults, and `readDeviceSettings`, which makes usable settings out of anything read back; and shortcuts written as Electron writes them (`device/shortcuts.ts`): recorded from a key press, checked, matched against a key press, and shown as each system labels its keys. The app keeps the settings where it likes; the desktop app keeps them in a file of its data folder.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/client`, `@repo/client/react` for React hooks, and `@repo/client/transports/local` for a core on the same machine

`@repo/client/transports/local` is the one part that needs Node. It is compiled as a project of its own (`tsconfig.node.json`), so the rest of the package cannot use a Node API by accident.

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
