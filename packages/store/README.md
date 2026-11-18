# @repo/store

The SQLite adapter: immutable records, keyword and vector search, files by content hash. Built so far: the records, with their tombstones, and keyword search.

A user's data is one file, `store.sqlite`, in their data folder. It is opened with Node's built-in `node:sqlite`, so there is no native module to build for each system. Changes to its layout are numbered files in `src/migrations`; one that was released is never edited.

`openStore` gives the core two ports: `records` and `search`. The search is SQLite's FTS5 (`src/search/keyword.ts`), ranked by bm25 and, when asked, by how recent a record is. It is derived data: each record is taken into it in the transaction that writes it, with the text the core's `searchableText` gives, and on opening it takes in whatever it has not seen. A tombstone (`ERASURE` in `@repo/core`) empties the records it names and takes them out of the index.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/store`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
