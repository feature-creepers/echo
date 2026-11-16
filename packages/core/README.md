# @repo/core

The assistant itself: the channel, the orchestrator, threads, memory and personas. It is pure logic: everything it needs from outside is an interface in `src/ports`.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/core`

The import rule is enforced by `tooling/eslint/boundaries.js` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
