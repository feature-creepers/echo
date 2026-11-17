# @repo/client

Client logic with no interface: the connection to a core, the state derived from its events (settings, conversation, harnesses, view, memory and whether the assistant is asleep), speech playback, and the memory as Markdown. Shared by the desktop app and, later, the phone app.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/client`, `@repo/client/react` for React hooks, and `@repo/client/transports/local` for a core on the same machine

`@repo/client/transports/local` is the one part that needs Node. It is compiled as a project of its own (`tsconfig.node.json`), so the rest of the package cannot use a Node API by accident.

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
