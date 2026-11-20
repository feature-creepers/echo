# @repo/store

The storage adapter. `openStore` gives the core five ports, all in the user's data folder:

- **`records`**: immutable records with their tombstones, in one SQLite file, `store.sqlite`, opened with Node's built-in `node:sqlite`, so there is no native module to build for each system. A tombstone (`ERASURE` in `@repo/core`) empties the records it names.
- **`search`**: keyword search over the records with SQLite's FTS5 (`src/search/keyword.ts`), ranked by bm25 and, when asked, by how recent a record is. Each record is indexed in the transaction that writes it; on opening, the index takes in whatever it has not seen.
- **`vectors`**: the records' vectors for search by meaning, in the same file, in a `vec0` table of [sqlite-vec](https://github.com/asg017/sqlite-vec) (`src/search/vectors.ts`), each with the name of the model that made it, its record's type and date. The file is opened with extensions allowed, sqlite-vec is loaded from its package (unpacked beside the archive in a packaged app), and loading is refused from then on. The table is derived data made when the extension loads, not a numbered migration: where sqlite-vec cannot load, `available()` says why, the other calls find nothing, and the rest works as before. Vectors of other dimensions than the table's drop it and make it again. An erasure takes the vectors of the records it names in the transaction that writes it. Vectors are never synced or exported.
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
