# services/

Flat directory, deliberately. This note exists so the next person doesn't
re-litigate it from scratch.

## Why not `services/book/`?

`services/` holds ~35 non-test modules. Six of them share a `book-*` prefix
(`book-assets`, `book-catalog`, `book-errors`, `book-lifecycle`,
`book-lineage`, `book-paths`), which could plausibly move under a
`services/book/` subdirectory to read as a package rather than a spill.

We considered it and decided against it, for Phase 4 of the "remove stores"
migration (task 7):

- The `book-*` prefix already does the job a subdirectory would do — it
  groups the cluster visually in a directory listing and in imports
  (`import { ... } from '../services/book-catalog'`), without adding a path
  segment.
- The six `book-*` modules have a combined ~95 import sites across the
  codebase (7-25 importers each). Moving them means touching every one of
  those import paths purely for cosmetics, at the tail end of a four-phase
  migration that has already changed a lot of import surface. The
  risk/churn is real; the readability gain over the existing prefix
  convention is marginal.
- A flat directory with a consistent naming convention is a legitimate,
  common pattern for a services layer of this size. 35 modules is not large
  enough that flat-vs-nested materially affects navigability — editors and
  `grep` handle it fine either way.

If `services/` keeps growing (new prefix clusters, files pushing past
~50-60), this is worth revisiting. For now: not reorganized, and this is
why.
