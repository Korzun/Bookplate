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
- Moving them means rewriting 72 import lines across 42 distinct files
  (`git grep -lE "from '[^']*services/book-(assets|catalog|errors|lifecycle|lineage|paths)'" -- app/server`),
  purely for cosmetics, at the tail end of a four-phase migration that has
  already changed a lot of import surface.
- It would also strand the 57 doc-comment citations that name these modules
  by path — the same provenance notes the migration deliberately wrote to
  explain where code came from. They would either go stale or need a second
  sweep of their own.
- The risk/churn is real; the readability gain over the existing prefix
  convention is marginal.
- A flat directory with a consistent naming convention is a legitimate,
  common pattern for a services layer of this size. 35 modules is not large
  enough that flat-vs-nested materially affects navigability — editors and
  `grep` handle it fine either way.

If `services/` keeps growing (new prefix clusters, files pushing past
~50-60), this is worth revisiting. For now: not reorganized, and this is
why.
