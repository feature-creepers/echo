# @repo/testing

A placeholder for shared test doubles of the core's ports. It exports nothing yet, and nothing imports it: the core's own stand-ins are in `packages/core/src/replay/`.

- **Runs in:** Node
- **May import:** `@repo/core`, `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/testing`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).
