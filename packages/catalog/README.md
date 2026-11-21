# @repo/catalog

The view format and the catalogue of blocks a model may compose, as zod schemas: descriptions and validation only. Drawing belongs to the renderers. It also reads the GeoJSON a map names (`src/geo.ts`) and the readings of a feed (`src/feed.ts`), so the core and the renderers check them the same way.

- **Runs in:** Anywhere: Node, a browser. No Node API, no DOM
- **May import:** Nothing from this repository
- **Entry points:** `@repo/catalog`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/catalog test
```
