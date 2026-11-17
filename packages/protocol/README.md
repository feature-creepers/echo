# @repo/protocol

The messages exchanged between a client and the core, and the rules for versioning them. Both sides build against this package, so a client and a core that share a protocol version can always talk.

A connection starts with a handshake (`handshake.ts`). After it, a client sends commands, the core answers each with a result, and sends events to every client (`envelope.ts`). The commands and events that exist are listed in `commands.ts` and `events.ts`.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** Nothing from this repository
- **Entry points:** `@repo/protocol`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
