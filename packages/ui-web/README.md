# @repo/ui-web

The interface for web renderers: catalogue components, the stage, the shell and the inspector. Built so far: first launch, the assistant present with its persona, and settings.

Styles are CSS modules beside each component. Colours, sizes and durations come from `@repo/tokens`: the app calls `applyTheme` once, before the first draw.

- **Runs in:** A browser window
- **May import:** `@repo/client`, `@repo/protocol`, `@repo/catalog`, `@repo/tokens`
- **Entry points:** `@repo/ui-web`

The import rule is enforced by `tooling/eslint/boundaries.js` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
