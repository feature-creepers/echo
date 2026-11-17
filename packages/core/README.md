# @repo/core

The assistant itself: the channel, the orchestrator, threads, memory and personas. It is pure logic: everything it needs from outside is an interface in `src/ports`.

`createCore` gives what a listener needs: admit a client, carry out a command, announce an event.

A persona is data. `src/personas/defaults.ts` is the only file that contains the default names, and nothing else in the repository names a persona: behaviour depends on a persona's stance, never on which one it is.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/core`

The import rule is enforced by `tooling/eslint/boundaries.js` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
