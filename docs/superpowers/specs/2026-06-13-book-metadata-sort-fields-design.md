# Book Metadata: Title Sort, Author Sort, Publish Date

**Date:** 2026-06-13

## Overview

Three changes to book metadata:

1. Rename the existing `fileAs` field to `titleSort` through the entire stack (DB, server types, epub parser/writer, API, client).
2. Add `authorSort` as a new strictly independent field sourced from `dc:creator file-as`.
3. Add `publishDate` as a new field sourced from `dc:date`, validated as ISO 8601, editable in the metadata editor and displayed on the book detail page (replacing `addedAt`).

---

## Data Layer

### Migration

A single Prisma migration (`20260613120000_rename_file_as_add_author_sort_publish_date`) applies three DDL statements to the `books` table:

```sql
ALTER TABLE books RENAME COLUMN file_as TO title_sort;
ALTER TABLE books ADD COLUMN author_sort TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN publish_date TEXT NOT NULL DEFAULT '';
```

Existing rows retain their `file_as` data under the new `title_sort` column. `author_sort` and `publish_date` default to empty string for all existing books.

### Prisma Schema (`schema.prisma`)

```prisma
titleSort   String  @default("") @map("title_sort")
authorSort  String  @default("") @map("author_sort")
publishDate String  @default("") @map("publish_date")
```

Replaces the current `fileAs String @default("") @map("file_as")`.

### Server Types (`types.ts`)

`Book` and `EpubMeta` interfaces: replace `fileAs: string` with three fields:

```ts
titleSort: string;
authorSort: string;
publishDate: string;
```

---

## EPUB Parsing (`epub-parser.ts`)

The current combined `fileAs` logic is replaced with three strictly independent extractions.

### `titleSort`

Sourced from `dc:title`'s `file-as` attribute only (`@file-as` / `@opf:file-as`), with the existing EPUB 3 `<meta refines property="file-as">` fallback for the title element. No fallback to creator.

### `authorSort`

Sourced from `dc:creator`'s `file-as` attribute only (`@file-as` / `@opf:file-as`). No fallback to title.

### `publishDate`

Sourced from `dc:date` as a raw string. Validated against ISO 8601 before being returned — accepts partial dates (`"2023"`, `"2023-01"`, `"2023-01-15"`) and full datetime strings (e.g. `"2023-01-15T00:00:00Z"`). Any value that does not match is silently discarded (returned as `""`).

ISO 8601 validation regex:
```
/^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/
```

---

## EPUB Writing (`epub-writer.ts`)

`EpubChanges` interface: replace `fileAs?: string` with:

```ts
titleSort?: string;
authorSort?: string;
publishDate?: string;
```

Writing logic:

- **`titleSort`** — writes the `file-as` attribute on `dc:title`. The author and title fields are no longer co-written in one block; each is written independently.
- **`authorSort`** — writes the `file-as` attribute on `dc:creator` independently of title.
- **`publishDate`** — writes/replaces `dc:date`. If the value is an empty string, any existing `dc:date` element is removed.

---

## API Layer (`routes/ui.ts`)

`PATCH /api/books/:id/metadata` accepts `titleSort`, `authorSort`, and `publishDate` body fields in place of `fileAs`.

`publishDate` is validated as ISO 8601 server-side (same regex as the parser). If invalid, the handler returns `400 { error: 'publishDate must be a valid ISO 8601 date string' }`.

`book-store.ts` maps the updated `EpubMeta` fields (`titleSort`, `authorSort`, `publishDate`) to the corresponding DB columns on import and reimport.

---

## Client Types (`provider/book/type.ts`)

```ts
titleSort?: string;
authorSort?: string;
publishDate?: string;
```

Replaces `fileAs: string`. All three are optional since any may be absent.

---

## Edit Form (`component/book-edit-form/index.tsx`)

- **"File As" → "Title Sort"**: existing field renamed, bound to `titleSort`.
- **"Author Sort"**: new `TextInput` added immediately below the Author field, bound to `authorSort`.
- **"Publish Date"**: new `TextInput` with an `onValidChange` validator that rejects strings not matching the ISO 8601 regex. An empty string is valid (clears the field). Invalid strings block the Save button via the existing `isEditValid` mechanism.

Field order in the main card: Title, Author, Author Sort, Title Sort, Publisher, Publish Date.

The `handleSave` payload includes `titleSort`, `authorSort`, and `publishDate` with the same dirty-check pattern used for other fields (only sends the field if it differs from the original). For `publishDate`, the comparison uses `(publishDate ?? '') !== (original.publishDate ?? '')` to handle the undefined/empty-string boundary correctly. Sending an empty string clears the field (removes `dc:date` from the EPUB).

---

## Book Detail Page (`page/book/index.tsx`)

`addedAt` is removed from the metadata list. `publishDate` is added in its place, shown only when non-empty. Display format: the raw string value from the book (no reformatting, since dates may be partial).

---

## Out of Scope

- OPDS feed changes (OPDS currently only uses `fileAs` for sort ordering; this is updated to `titleSort` as part of the rename but no new fields are surfaced in the feed).
- Displaying `titleSort` or `authorSort` outside the edit form.
- Backfilling `authorSort` or `publishDate` for existing books (users can edit metadata individually to populate these fields).
