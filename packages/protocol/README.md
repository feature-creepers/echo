# @repo/protocol

The messages exchanged between a client and the core, and the rules for versioning them. Both sides build against this package, so a client and a core that share a protocol version can always talk.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** Nothing from this repository
- **Entry points:** `@repo/protocol`

The import rule is enforced by `tooling/eslint/boundaries.js` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
