# @repo/protocol

The messages exchanged between a client and the core, as zod schemas, and the rules for versioning them. Both sides build against this package, so a client and a core that share a protocol version can always talk.

A connection starts with a handshake (`src/handshake.ts`). After it, a client sends commands, the core answers each with a result, and sends events to every client (`src/envelope.ts`), one JSON message per line (`src/codec.ts`). The commands are defined by area in `src/commands/` and the events in `src/events/`, gathered in `src/commands.ts` and `src/events.ts`. `src/launch.ts` is the agreement between a core and the program that starts it.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** Nothing from this repository
- **Entry points:** `@repo/protocol`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/protocol test
```
