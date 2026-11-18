/**
 * Keyword search over the text of the records (docs/SPEC.md, section 10.3). The index is derived data: it
 * is filled from the records, and rebuilt from them when it is behind, never synced.
 */
export const search = `
  -- The text of each record that has some, as the core's searchableText gives it. Accents and case are
  -- folded, so "Elodie" finds "Élodie".
  create virtual table search_text using fts5(
    text,
    record unindexed,              -- the record the text belongs to
    tokenize = 'unicode61 remove_diacritics 2'
  );

  -- How far the index has read the record table: the rowid of the last record it took in.
  create table search_progress (
    indexed integer not null
  ) strict;
  insert into search_progress (indexed) values (0);
`
