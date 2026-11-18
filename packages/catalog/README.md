# @repo/catalog

The view format and the catalogue of components a model may compose. It holds descriptions and validation only: drawing belongs to the renderers.

The map blocks (`src/blocks/map.ts`) name the GeoJSON they draw; `src/geo.ts` reads such a file and checks that a map's figures find their areas, so the core can tell a model what to correct before a map is shown (docs/SPEC.md, section 9.6).

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** Nothing from this repository
- **Entry points:** `@repo/catalog`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
