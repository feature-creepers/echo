# @repo/store

The SQLite adapter: immutable records, keyword and vector search, files by content hash. Built so far: the records.

A user's data is one file, `store.sqlite`, in their data folder. It is opened with Node's built-in `node:sqlite`, so there is no native module to build for each system. Changes to its layout are numbered files in `src/migrations`; one that was released is never edited.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/store`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
