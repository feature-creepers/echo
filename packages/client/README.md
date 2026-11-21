# @repo/client

Client logic with no interface: the connection to a core and its handshake, the state derived from the core's events (settings, conversation, threads, memory, library, schedule), speech playback, and the memory exported as Markdown. It also holds the settings of a device (`src/device/settings.ts`: their shape, their defaults, and `readDeviceSettings`, which makes usable settings out of anything read back) and shortcuts written as Electron writes them (`src/device/shortcuts.ts`). Where a device keeps its settings is the app's choice.

- **Runs in:** Anywhere: Node, a browser. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/client`, `@repo/client/react` for React hooks, and `@repo/client/transports/local` for a core on the same machine

`@repo/client/transports/local` is the one part that needs Node. It is compiled as a project of its own (`tsconfig.node.json`), so the rest of the package cannot use a Node API by accident.

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/client test
```
