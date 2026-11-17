/** The first layout: who owns the file, and the records. */
export const records = `
  -- The core that owns this file. One row, written the first time the file is opened.
  create table core (
    id text not null
  ) strict;

  -- Records are written once and never changed. Their order in the table is the order they arrived in.
  create table record (
    id       text primary key,     -- identifies the record everywhere
    origin   text not null,        -- the core that wrote it
    sequence integer not null,     -- its position among the records of that core, from 1
    at       text not null,        -- when it was written: ISO 8601, UTC
    type     text not null,        -- tells how to read the payload
    payload  text not null,        -- JSON
    unique (origin, sequence)
  ) strict;

  create index record_by_type on record (type);
`
