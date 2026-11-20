# @repo/store

The storage adapter. `openStore` gives the core four ports, all in the user's data folder:

- **`records`**: immutable records with their tombstones, in one SQLite file, `store.sqlite`, opened with Node's built-in `node:sqlite`, so there is no native module to build for each system. A tombstone (`ERASURE` in `@repo/core`) empties the records it names.
- **`search`**: keyword search over the records with SQLite's FTS5 (`src/search/keyword.ts`), ranked by bm25 and, when asked, by how recent a record is. Each record is indexed in the transaction that writes it; on opening, the index takes in whatever it has not seen.
- **`blobs`** and **`versions`**: files' contents, one file per hash, in the `files` and `versions` folders beside the database.

Changes to the database's layout are numbered files in `src/migrations`; one that was released is never edited.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/store`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/store test
```
