# @repo/tokens

Design values (colours and the personas' accents, the window's frame, type, motion) as plain data, for any renderer, and the Tailwind theme generated from them.

- **Runs in:** Anywhere: Node, a browser. No Node API, no DOM
- **May import:** Nothing from this repository
- **Entry points:** `@repo/tokens`, and `@repo/tokens/theme.css`, the generated Tailwind theme that `@repo/ui-web` imports

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/tokens test
```

`src/theme.generated.css` is written by `pnpm theme` at the root. Run it after changing a value: a test fails while the file is out of date.
