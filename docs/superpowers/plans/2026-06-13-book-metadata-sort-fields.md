# Book Metadata Sort Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `fileAs` → `titleSort` through the entire stack and add new `authorSort` and `publishDate` fields to book metadata, the epub parser/writer, the database, the API, and the UI.

**Architecture:** A single database migration renames the `file_as` column to `title_sort` and adds `author_sort` and `publish_date`. The epub parser and writer are updated to handle each field independently. The API, book store, client types, edit form, and book detail page are updated to match.

**Tech Stack:** SQLite + Prisma (server DB), TypeScript, Node.js (server), React + Aphrodite (client), Vitest (tests).

---

## File Map

| Action | Path |
|--------|------|
| Create | `app/server/prisma/migrations/20260613120000_rename_file_as_add_author_sort_publish_date/migration.sql` |
| Modify | `app/server/prisma/schema.prisma` |
| Modify | `app/server/types.ts` |
| Modify | `app/server/services/epub-parser.ts` |
| Modify | `app/server/services/epub-parser.test.ts` |
| Modify | `app/server/services/epub-writer.ts` |
| Modify | `app/server/services/epub-writer.test.ts` |
| Modify | `app/server/services/book-store.ts` |
| Modify | `app/server/services/book-store.test.ts` |
| Modify | `app/server/routes/ui.ts` |
| Modify | `app/server/routes/ui.test.ts` |
| Modify | `app/server/routes/opds.test.ts` |
| Modify | `app/client/src/provider/book/type.ts` |
| Modify | `app/client/src/provider/book/hook/use-patch-book-metadata.ts` |
| Modify | `app/client/src/component/book-edit-form/index.tsx` |
| Modify | `app/client/src/page/book/index.tsx` |

---

## Task 1: Migration, Prisma Schema, and Server Types

**Files:**
- Create: `app/server/prisma/migrations/20260613120000_rename_file_as_add_author_sort_publish_date/migration.sql`
- Modify: `app/server/prisma/schema.prisma`
- Modify: `app/server/types.ts`

- [ ] **Step 1: Create the migration SQL file**

Create directory `app/server/prisma/migrations/20260613120000_rename_file_as_add_author_sort_publish_date/` and write `migration.sql`:

```sql
-- Rename file_as to title_sort, add author_sort and publish_date
ALTER TABLE books RENAME COLUMN file_as TO title_sort;
ALTER TABLE books ADD COLUMN author_sort TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN publish_date TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: Update `app/server/prisma/schema.prisma`**

In the `Book` model, replace:
```prisma
fileAs          String          @default("") @map("file_as")
```
with:
```prisma
titleSort       String          @default("") @map("title_sort")
authorSort      String          @default("") @map("author_sort")
publishDate     String          @default("") @map("publish_date")
```

- [ ] **Step 3: Regenerate the Prisma client**

```bash
cd app/server && npx prisma generate
```

Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 4: Update `app/server/types.ts`**

In the `Book` interface, replace `fileAs: string;` with:
```ts
titleSort: string;
authorSort: string;
publishDate: string;
```

In the `EpubMeta` interface, replace `fileAs: string;` with:
```ts
titleSort: string;
authorSort: string;
publishDate: string;
```

- [ ] **Step 5: Commit**

```bash
git add app/server/prisma/migrations/20260613120000_rename_file_as_add_author_sort_publish_date/migration.sql \
        app/server/prisma/schema.prisma \
        app/server/types.ts
git commit -m "feat: migration and types for titleSort, authorSort, publishDate"
```

---

## Task 2: EPUB Parser

**Files:**
- Modify: `app/server/services/epub-parser.ts`
- Modify: `app/server/services/epub-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/server/services/epub-parser.test.ts`, make the following changes:

**a) Update the empty-defaults test** (around line 300). Replace:
```ts
expect(meta.fileAs).toBe('');
```
with:
```ts
expect(meta.titleSort).toBe('');
expect(meta.authorSort).toBe('');
expect(meta.publishDate).toBe('');
```

**b) Update the "parses title-level file-as" test** (around line 320). Replace:
```ts
expect(meta.fileAs).toBe('Asimov, Isaac');
```
with:
```ts
expect(meta.titleSort).toBe('Asimov, Isaac');
expect(meta.authorSort).toBe('');
```

**c) Update the "returns empty fileAs" test** (around line 342). Change the description and replace:
```ts
it('returns an empty fileAs when the chosen title has no file-as attribute', () => {
  ...
  expect(meta.fileAs).toBe('');
```
with:
```ts
it('returns empty titleSort when the chosen title has no file-as attribute', () => {
  ...
  expect(meta.titleSort).toBe('');
  expect(meta.authorSort).toBe('');
```

**d) Update the "opf namespace attribute" test** (around line 352). Replace:
```ts
expect(meta.fileAs).toBe('Asimov, Isaac');
```
with:
```ts
expect(meta.titleSort).toBe('Asimov, Isaac');
expect(meta.authorSort).toBe('');
```

**e) Update the "EPUB 3 refines" test** (around line 374). Replace:
```ts
expect(meta.fileAs).toBe('Asimov, Isaac');
```
with:
```ts
expect(meta.titleSort).toBe('Asimov, Isaac');
expect(meta.authorSort).toBe('');
```

**f) Add new authorSort test** after the refines test:

```ts
it('parses authorSort from dc:creator file-as attribute independently', () => {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Foundation</dc:title>
    <dc:creator file-as="Asimov, Isaac">Isaac Asimov</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
  );
  const filePath = path.join(tmpDir, 'foundation-creator-fileas.epub');
  fs.writeFileSync(filePath, zip.toBuffer());

  const meta = parseEpub(filePath);

  expect(meta.author).toBe('Isaac Asimov');
  expect(meta.authorSort).toBe('Asimov, Isaac');
  expect(meta.titleSort).toBe('');
});

it('does not fall back to authorSort when titleSort is absent', () => {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>No Title Sort</dc:title>
    <dc:creator file-as="Sort, Author">Author Name</dc:creator>
  </metadata>
  <manifest/><spine/>
</package>`)
  );
  const filePath = path.join(tmpDir, 'no-title-sort.epub');
  fs.writeFileSync(filePath, zip.toBuffer());

  const meta = parseEpub(filePath);

  expect(meta.titleSort).toBe('');
  expect(meta.authorSort).toBe('Sort, Author');
});
```

**g) Add publishDate tests** after the authorSort tests:

```ts
it('parses a valid ISO 8601 date from dc:date', () => {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Dated Book</dc:title>
    <dc:date>2001-01-16</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
  );
  const filePath = path.join(tmpDir, 'dated.epub');
  fs.writeFileSync(filePath, zip.toBuffer());

  expect(parseEpub(filePath).publishDate).toBe('2001-01-16');
});

it('accepts partial ISO 8601 dates (year only, year-month)', () => {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Year Book</dc:title>
    <dc:date>2001</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
  );
  const filePath = path.join(tmpDir, 'year-only.epub');
  fs.writeFileSync(filePath, zip.toBuffer());

  expect(parseEpub(filePath).publishDate).toBe('2001');
});

it('discards an invalid dc:date value and returns empty string', () => {
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml', Buffer.from(sharedContainerXml));
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Bad Date Book</dc:title>
    <dc:date>not-a-date</dc:date>
  </metadata>
  <manifest/><spine/>
</package>`)
  );
  const filePath = path.join(tmpDir, 'bad-date.epub');
  fs.writeFileSync(filePath, zip.toBuffer());

  expect(parseEpub(filePath).publishDate).toBe('');
});

it('returns empty publishDate when dc:date is absent', () => {
  const filePath = path.join(tmpDir, 'no-date.epub');
  fs.writeFileSync(filePath, makeEpub({ title: 'No Date' }));

  expect(parseEpub(filePath).publishDate).toBe('');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w app/server -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|titleSort|authorSort|publishDate|fileAs" | head -40
```

Expected: multiple failures referencing `titleSort`, `authorSort`, `publishDate` not found on result.

- [ ] **Step 3: Update `app/server/services/epub-parser.ts`**

**a) Add the ISO 8601 validation constant** before the `parseEpub` function (or near the top of the module):

```ts
const ISO_8601_RE =
  /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;
```

**b) Replace the combined `fileAs` block** (currently lines ~440-452):

Remove:
```ts
  // file-as: prefer dc:title attribute (EPUB 2 / Calibre), fall back to dc:creator file-as, then EPUB 3 <meta refines>
  const attrFileAs = titleCandidate.text ? titleCandidate.fileAs : '';
  const creatorFileAs = creatorCandidate.fileAs;
  const refinesMeta =
    !attrFileAs && !creatorFileAs && titleCandidate.id
      ? metas.find(
          (m) => m['@_property'] === 'file-as' && m['@_refines'] === `#${titleCandidate.id}`
        )
      : undefined;
  const fileAs =
    attrFileAs ||
    creatorFileAs ||
    (refinesMeta ? decodeEntities((refinesMeta['#text'] ?? '').trim()) : '');
```

Replace with:
```ts
  // titleSort: dc:title file-as only; EPUB 3 <meta refines> fallback for the title element
  const attrTitleSort = titleCandidate.text ? titleCandidate.fileAs : '';
  const refinesMeta =
    !attrTitleSort && titleCandidate.id
      ? metas.find(
          (m) => m['@_property'] === 'file-as' && m['@_refines'] === `#${titleCandidate.id}`
        )
      : undefined;
  const titleSort =
    attrTitleSort ||
    (refinesMeta ? decodeEntities((refinesMeta['#text'] ?? '').trim()) : '');

  // authorSort: dc:creator file-as only; no fallback to title
  const authorSort = creatorCandidate.fileAs;

  // publishDate: dc:date, validated as ISO 8601; discard invalid values
  const rawDate =
    typeof metadata['dc:date'] === 'string' ? metadata['dc:date'].trim() : '';
  const publishDate = ISO_8601_RE.test(rawDate) ? rawDate : '';
```

**c) Update the return statement** to use the new field names. Replace `fileAs,` in the return object with:
```ts
    titleSort,
    authorSort,
    publishDate,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w app/server -- --testPathPattern="epub-parser" --reporter=verbose 2>&1 | tail -20
```

Expected: all epub-parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/epub-parser.ts app/server/services/epub-parser.test.ts
git commit -m "feat: parse titleSort, authorSort, publishDate from EPUB metadata"
```

---

## Task 3: EPUB Writer

**Files:**
- Modify: `app/server/services/epub-writer.ts`
- Modify: `app/server/services/epub-writer.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/server/services/epub-writer.test.ts`:

**a) Update `makeEpub` helper** — rename `fileAs` option to `authorSort` (the file-as attribute on dc:creator) and add `titleSort` and `publishDate` options:

Replace the `opts` type and attributes in the helper:
```ts
function makeEpub(
  opts: {
    title?: string;
    author?: string;
    titleSort?: string;
    authorSort?: string;
    publishDate?: string;
    description?: string;
    publisher?: string;
    series?: string;
    seriesIndex?: number;
    identifiers?: { scheme?: string; value: string }[];
    subjects?: string[];
    coverData?: Buffer;
    coverMime?: string;
  } = {}
): Buffer {
```

Replace:
```ts
  const fileAsAttr = opts.fileAs ? ` file-as="${opts.fileAs}"` : '';
```
with:
```ts
  const titleSortAttr = opts.titleSort ? ` file-as="${opts.titleSort}"` : '';
  const authorSortAttr = opts.authorSort ? ` file-as="${opts.authorSort}"` : '';
  const dateElem = opts.publishDate ? `<dc:date>${opts.publishDate}</dc:date>` : '';
```

Replace:
```ts
    ${opts.author !== undefined ? `<dc:creator${fileAsAttr}>${opts.author}</dc:creator>` : ''}
```
with:
```ts
    ${opts.title !== undefined ? `<dc:title${titleSortAttr}>${opts.title}</dc:title>` : ''}
    ${opts.author !== undefined ? `<dc:creator${authorSortAttr}>${opts.author}</dc:creator>` : ''}
    ${dateElem}
```

And remove the plain `<dc:title>` line that currently exists when title is defined (since `makeEpub` now handles title in the same line).

> Note: update the existing `<dc:title>` line in the template to include `titleSortAttr` — do not add a second title element.

**b) Update the existing `fileAs` test** (around line 208). Replace:
```ts
  it('updates fileAs', () => {
    const f = toFile(makeEpub({ author: 'John Doe', fileAs: 'Doe, John' }));
    writeMetadata(f, { fileAs: 'Doe, J.' });
    expect(parseEpub(f).fileAs).toBe('Doe, J.');
  });
```
with:
```ts
  it('updates authorSort independently of author', () => {
    const f = toFile(makeEpub({ author: 'John Doe', authorSort: 'Doe, John' }));
    writeMetadata(f, { authorSort: 'Doe, J.' });
    expect(parseEpub(f).authorSort).toBe('Doe, J.');
    expect(parseEpub(f).author).toBe('John Doe');
  });

  it('updates author without affecting authorSort', () => {
    const f = toFile(makeEpub({ author: 'John Doe', authorSort: 'Doe, John' }));
    writeMetadata(f, { author: 'Jane Doe' });
    expect(parseEpub(f).author).toBe('Jane Doe');
    expect(parseEpub(f).authorSort).toBe('Doe, John');
  });

  it('updates titleSort independently of title', () => {
    const f = toFile(makeEpub({ title: 'The Foundation', titleSort: 'Foundation, The' }));
    writeMetadata(f, { titleSort: 'Foundation' });
    expect(parseEpub(f).titleSort).toBe('Foundation');
    expect(parseEpub(f).title).toBe('The Foundation');
  });

  it('updates title without affecting titleSort', () => {
    const f = toFile(makeEpub({ title: 'Old Title', titleSort: 'Title, Old' }));
    writeMetadata(f, { title: 'New Title' });
    expect(parseEpub(f).title).toBe('New Title');
    expect(parseEpub(f).titleSort).toBe('Title, Old');
  });

  it('adds publishDate to an epub with no dc:date', () => {
    const f = toFile(makeEpub({ title: 'No Date' }));
    writeMetadata(f, { publishDate: '2001-01-16' });
    expect(parseEpub(f).publishDate).toBe('2001-01-16');
  });

  it('updates an existing publishDate', () => {
    const f = toFile(makeEpub({ title: 'Dated', publishDate: '2000-01-01' }));
    writeMetadata(f, { publishDate: '2001-01-16' });
    expect(parseEpub(f).publishDate).toBe('2001-01-16');
  });

  it('removes publishDate when empty string is given', () => {
    const f = toFile(makeEpub({ title: 'Dated', publishDate: '2000-01-01' }));
    writeMetadata(f, { publishDate: '' });
    expect(parseEpub(f).publishDate).toBe('');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w app/server -- --testPathPattern="epub-writer" --reporter=verbose 2>&1 | tail -30
```

Expected: failures on `titleSort`, `authorSort`, `publishDate` properties.

- [ ] **Step 3: Update `app/server/services/epub-writer.ts`**

**a) Update the `EpubChanges` interface** — replace `fileAs?: string;` with:
```ts
  titleSort?: string;
  authorSort?: string;
  publishDate?: string;
```

**b) Replace the title write block** (currently `if (changes.title !== undefined)`) with a combined title+titleSort block:

Remove:
```ts
  if (changes.title !== undefined) {
    metadata['dc:title'] = [changes.title];
  }
```

Replace with:
```ts
  // dc:title: update title and/or titleSort together to preserve each other
  if (changes.title !== undefined || changes.titleSort !== undefined) {
    const existingTitleArr = (metadata['dc:title'] as unknown[]) ?? [];
    const existingTitle0 = existingTitleArr[0];
    const currentTitle =
      changes.title ??
      (typeof existingTitle0 === 'string'
        ? existingTitle0
        : ((existingTitle0 as Record<string, string>)?.['#text'] ?? ''));
    const currentTitleSort =
      changes.titleSort ??
      (typeof existingTitle0 === 'object' && existingTitle0 !== null
        ? ((existingTitle0 as Record<string, string>)['@_file-as'] ??
          (existingTitle0 as Record<string, string>)['@_opf:file-as'] ??
          '')
        : '');
    metadata['dc:title'] = currentTitleSort
      ? [{ '#text': currentTitle, '@_file-as': currentTitleSort }]
      : [currentTitle];
  }
```

**c) Replace the author+fileAs block** with an author+authorSort block:

Remove:
```ts
  // author and fileAs both live on dc:creator; update them together to preserve each other
  if (changes.author !== undefined || changes.fileAs !== undefined) {
    const existing = ((metadata['dc:creator'] as unknown[]) ?? [])[0];
    const currentAuthor =
      changes.author ??
      (typeof existing === 'string'
        ? existing
        : ((existing as Record<string, string>)?.['#text'] ?? ''));
    const currentFileAs =
      changes.fileAs ??
      (typeof existing === 'object' && existing !== null
        ? ((existing as Record<string, string>)['@_file-as'] ??
          (existing as Record<string, string>)['@_opf:file-as'] ??
          '')
        : '');
    metadata['dc:creator'] = currentFileAs
      ? [{ '#text': currentAuthor, '@_file-as': currentFileAs }]
      : [currentAuthor];
  }
```

Replace with:
```ts
  // dc:creator: update author and/or authorSort together to preserve each other
  if (changes.author !== undefined || changes.authorSort !== undefined) {
    const existingCreatorArr = (metadata['dc:creator'] as unknown[]) ?? [];
    const existingCreator0 = existingCreatorArr[0];
    const currentAuthor =
      changes.author ??
      (typeof existingCreator0 === 'string'
        ? existingCreator0
        : ((existingCreator0 as Record<string, string>)?.['#text'] ?? ''));
    const currentAuthorSort =
      changes.authorSort ??
      (typeof existingCreator0 === 'object' && existingCreator0 !== null
        ? ((existingCreator0 as Record<string, string>)['@_file-as'] ??
          (existingCreator0 as Record<string, string>)['@_opf:file-as'] ??
          '')
        : '');
    metadata['dc:creator'] = currentAuthorSort
      ? [{ '#text': currentAuthor, '@_file-as': currentAuthorSort }]
      : [currentAuthor];
  }
```

**d) Add the publishDate write block** after the author/authorSort block:

```ts
  // dc:date: set or remove publishDate
  if (changes.publishDate !== undefined) {
    if (changes.publishDate === '') {
      delete metadata['dc:date'];
    } else {
      metadata['dc:date'] = changes.publishDate;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w app/server -- --testPathPattern="epub-writer" --reporter=verbose 2>&1 | tail -20
```

Expected: all epub-writer tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/epub-writer.ts app/server/services/epub-writer.test.ts
git commit -m "feat: write titleSort, authorSort, publishDate to EPUB OPF"
```

---

## Task 4: Book Store

**Files:**
- Modify: `app/server/services/book-store.ts`
- Modify: `app/server/services/book-store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/server/services/book-store.test.ts`:

**a) Update `FAKE_META`** — replace `fileAs: '',` with:
```ts
  titleSort: '',
  authorSort: '',
  publishDate: '',
```

**b) Rename the `fileAs` persistence test** (around line 236):
```ts
  it('persists titleSort on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Foundation',
      author: 'Isaac Asimov',
      titleSort: 'Asimov, Isaac',
    };
    await bookStore.addBook(owner, 'id1', stage('id1'), meta);
    const book = await bookStore.getBookById(owner, 'id1');
    expect(book!.titleSort).toBe('Asimov, Isaac');
  });
```

**c) Rename the trimming test** (around line 247):
```ts
  it('stores trimmed titleSort even when metadata has extra whitespace', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      titleSort: '  Asimov, Isaac  ',
    };
    await bookStore.addBook(owner, 'id2', stage('id2'), meta);
    const book = await bookStore.getBookById(owner, 'id2');
    expect(book!.titleSort).toBe('Asimov, Isaac');
  });
```

**d) Rename the sort tests** (around line 257 and 275):
```ts
  it('sorts by titleSort before title', async () => {
    await bookStore.addBook(owner, 'id-a', stage('id-a'), { ...FAKE_META, title: 'Zzz', titleSort: 'Apple, A.' });
    await bookStore.addBook(owner, 'id-z', stage('id-z'), { ...FAKE_META, title: 'Aaa', titleSort: 'Zulu, Z.' });
    const books = await bookStore.listBooks(owner);
    expect(books[0].id).toBe('id-a');
    expect(books[1].id).toBe('id-z');
  });

  it('falls back to title when titleSort is empty', async () => {
    await bookStore.addBook(owner, 'id-b', stage('id-b'), { ...FAKE_META, title: 'Banana', titleSort: '' });
    await bookStore.addBook(owner, 'id-a', stage('id-a'), { ...FAKE_META, title: 'Apple', titleSort: '' });
    const books = await bookStore.listBooks(owner);
    expect(books[0].id).toBe('id-a');
    expect(books[1].id).toBe('id-b');
  });
```

**e) Add `authorSort` and `publishDate` persistence tests**:
```ts
  it('persists authorSort on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      author: 'Isaac Asimov',
      authorSort: 'Asimov, Isaac',
    };
    await bookStore.addBook(owner, 'id-as', stage('id-as'), meta);
    const book = await bookStore.getBookById(owner, 'id-as');
    expect(book!.authorSort).toBe('Asimov, Isaac');
  });

  it('persists publishDate on stored books', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      publishDate: '2001-01-16',
    };
    await bookStore.addBook(owner, 'id-pd', stage('id-pd'), meta);
    const book = await bookStore.getBookById(owner, 'id-pd');
    expect(book!.publishDate).toBe('2001-01-16');
  });
```

**f) Update any remaining `fileAs: ''` references in existing test fixtures** (around lines 403, 455, 487) — replace each `fileAs: '',` with `titleSort: '', authorSort: '', publishDate: '',`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w app/server -- --testPathPattern="book-store" --reporter=verbose 2>&1 | tail -30
```

Expected: failures on `titleSort`, `authorSort`, `publishDate` property references.

- [ ] **Step 3: Update `app/server/services/book-store.ts`**

**a) Update `BOOK_SELECT`** — replace `fileAs: true,` with:
```ts
  titleSort: true,
  authorSort: true,
  publishDate: true,
```

**b) Update the sort comparator** (around lines 102-105). Replace:
```ts
    const aKey = a.fileAs !== '' ? a.fileAs : a.title;
    const bKey = b.fileAs !== '' ? b.fileAs : b.title;
```
with:
```ts
    const aKey = a.titleSort !== '' ? a.titleSort : a.title;
    const bKey = b.titleSort !== '' ? b.titleSort : b.title;
```
Also update the comment above: `// Replicate: ORDER BY CASE WHEN title_sort != '' THEN title_sort ELSE title END, title, id`

**c) Update `addBook`** (around lines 141-150). Replace:
```ts
    const fileAs = (meta.fileAs || '').trim();
    ...
        fileAs,
```
with:
```ts
    const titleSort = (meta.titleSort || '').trim();
    const authorSort = (meta.authorSort || '').trim();
    const publishDate = (meta.publishDate || '').trim();
    ...
        titleSort,
        authorSort,
        publishDate,
```

**d) Update `reimportBook` — first tx.book.update block** (around line 356-358). Replace:
```ts
            fileAs: (meta.fileAs || '').trim(),
```
with:
```ts
            titleSort: (meta.titleSort || '').trim(),
            authorSort: (meta.authorSort || '').trim(),
            publishDate: (meta.publishDate || '').trim(),
```

**e) Update `reimportBook` — second tx.book.update block** (around line 413-417). Replace:
```ts
            fileAs: (meta.fileAs || '').trim(),
```
with:
```ts
            titleSort: (meta.titleSort || '').trim(),
            authorSort: (meta.authorSort || '').trim(),
            publishDate: (meta.publishDate || '').trim(),
```

**f) Update `prismaBookToBook`** (around line 609). Replace:
```ts
      fileAs: r.fileAs,
```
with:
```ts
      titleSort: r.titleSort,
      authorSort: r.authorSort,
      publishDate: r.publishDate,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w app/server -- --testPathPattern="book-store" --reporter=verbose 2>&1 | tail -20
```

Expected: all book-store tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/book-store.ts app/server/services/book-store.test.ts
git commit -m "feat: map titleSort, authorSort, publishDate in book store"
```

---

## Task 5: API Route

**Files:**
- Modify: `app/server/routes/ui.ts`
- Modify: `app/server/routes/ui.test.ts`
- Modify: `app/server/routes/opds.test.ts`

- [ ] **Step 1: Write the failing tests**

In `app/server/routes/ui.test.ts`:

**a) Update `FAKE_META`** — replace `fileAs: '',` with:
```ts
  titleSort: '',
  authorSort: '',
  publishDate: '',
```

**b) Rename the `fileAs` API response test** (around line 312):
```ts
  it('returns titleSort in the books API response', async () => {
    const meta: EpubMeta = {
      ...FAKE_META,
      title: 'Foundation',
      titleSort: 'Asimov, Isaac',
      author: 'Isaac Asimov',
    };

    await bookStore.addBook(aliceOwner, 'foundation1', stage('foundation1'), meta);

    const token = await loginAlice();
    const res = await request(app)
      .get('/api/books')
      .set(...bearer(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    const [book] = res.body;
    expect(book.titleSort).toBe('Asimov, Isaac');
    expect(book.path).toBeUndefined();
    expect(book.description).toBeUndefined();
  });
```

**c) Update `opds.test.ts`** — in `FAKE_META`, replace `fileAs: '',` with:
```ts
  titleSort: '',
  authorSort: '',
  publishDate: '',
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w app/server -- --testPathPattern="(ui|opds)" --reporter=verbose 2>&1 | tail -30
```

Expected: TypeScript/type errors or test failures on `fileAs`.

- [ ] **Step 3: Update `app/server/routes/ui.ts`**

Add the ISO 8601 constant near the top of the file (after imports):
```ts
const ISO_8601_RE =
  /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;
```

In the `PATCH /api/books/:id/metadata` handler (around line 638), replace:
```ts
      if (body.fileAs !== undefined) changes.fileAs = body.fileAs;
```
with:
```ts
      if (body.titleSort !== undefined) changes.titleSort = body.titleSort;
      if (body.authorSort !== undefined) changes.authorSort = body.authorSort;
      if (body.publishDate !== undefined) {
        if (body.publishDate !== '' && !ISO_8601_RE.test(body.publishDate)) {
          res.status(400).json({ error: 'publishDate must be a valid ISO 8601 date string' });
          return;
        }
        changes.publishDate = body.publishDate;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -w app/server -- --testPathPattern="(ui|opds)" --reporter=verbose 2>&1 | tail -20
```

Expected: all ui and opds tests pass.

- [ ] **Step 5: Run the full server test suite**

```bash
npm test -w app/server 2>&1 | tail -20
```

Expected: all server tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/server/routes/ui.ts app/server/routes/ui.test.ts app/server/routes/opds.test.ts
git commit -m "feat: accept titleSort, authorSort, publishDate in metadata PATCH API"
```

---

## Task 6: Client Types and Patch Hook

**Files:**
- Modify: `app/client/src/provider/book/type.ts`
- Modify: `app/client/src/provider/book/hook/use-patch-book-metadata.ts`

- [ ] **Step 1: Update `app/client/src/provider/book/type.ts`**

Replace:
```ts
  fileAs: string;
```
with:
```ts
  titleSort?: string;
  authorSort?: string;
  publishDate?: string;
```

- [ ] **Step 2: Update `app/client/src/provider/book/hook/use-patch-book-metadata.ts`**

In `BookMetadataPatch`, replace:
```ts
  fileAs: string;
```
with:
```ts
  titleSort: string;
  authorSort: string;
  publishDate: string;
```

- [ ] **Step 3: Run client lint to catch type errors**

```bash
npm run lint -w app/client 2>&1 | head -40
```

Expected: any remaining `fileAs` references in client code are flagged. Fix them before committing.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/provider/book/type.ts \
        app/client/src/provider/book/hook/use-patch-book-metadata.ts
git commit -m "feat: update client Book type and patch hook for new sort fields"
```

---

## Task 7: Edit Form

**Files:**
- Modify: `app/client/src/component/book-edit-form/index.tsx`

- [ ] **Step 1: Update state and handlers**

In `app/client/src/component/book-edit-form/index.tsx`:

**a) Replace the `fileAs` state block**:

Remove:
```ts
  const [fileAs, setFileAs] = useState<string | undefined>(original.fileAs);
  const handleFileAsChange = useCallback((newFileAs: string | undefined) => {
    setFileAs(newFileAs);
  }, []);
```

Replace with:
```ts
  const [titleSort, setTitleSort] = useState<string | undefined>(original.titleSort);
  const handleTitleSortChange = useCallback((newTitleSort: string | undefined) => {
    setTitleSort(newTitleSort);
  }, []);

  const [authorSort, setAuthorSort] = useState<string | undefined>(original.authorSort);
  const handleAuthorSortChange = useCallback((newAuthorSort: string | undefined) => {
    setAuthorSort(newAuthorSort);
  }, []);

  const [publishDate, setPublishDate] = useState<string | undefined>(original.publishDate);
  const handlePublishDateChange = useCallback((newPublishDate: string | undefined) => {
    setPublishDate(newPublishDate);
  }, []);
```

**b) Update `handleSave`** — replace:
```ts
      fileAs: fileAs && fileAs.trim() !== original.fileAs ? fileAs.trim() : undefined,
```
with:
```ts
      titleSort:
        titleSort !== undefined && titleSort.trim() !== (original.titleSort ?? '')
          ? titleSort.trim()
          : undefined,
      authorSort:
        authorSort !== undefined && authorSort.trim() !== (original.authorSort ?? '')
          ? authorSort.trim()
          : undefined,
      publishDate:
        (publishDate ?? '') !== (original.publishDate ?? '') ? (publishDate ?? '') : undefined,
```

- [ ] **Step 2: Update the form JSX**

Replace the entire `<div className={styles.cardContainer}>` block (currently contains Title, Author, File As, Publisher) with:

```tsx
        <div className={styles.cardContainer}>
          <TextInput value={title} label="Title" name="title" onChange={handleTitleChange} />
          <TextInput value={author} label="Author" name="author" onChange={handleAuthorChange} />
          <TextInput
            value={authorSort}
            label="Author Sort"
            name="authorSort"
            onChange={handleAuthorSortChange}
          />
          <TextInput
            value={titleSort}
            label="Title Sort"
            name="titleSort"
            onChange={handleTitleSortChange}
          />
          <TextInput
            value={publisher}
            label="Publisher"
            name="publisher"
            onChange={handlePublisherChange}
          />
          <TextInput
            value={publishDate}
            label="Publish Date"
            name="publishDate"
            onChange={handlePublishDateChange}
            onValidChange={handleIsValidChange}
            validate={(v) =>
              !v ||
              /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/.test(v)
            }
          />
        </div>
```

`TextInput`'s `validate` prop takes `(value: string) => boolean` — returning `true` means valid, `false` means invalid and blocks Save via `isEditValid`. An empty string returns `true` (clearing the field is allowed).

- [ ] **Step 3: Run lint**

```bash
npm run lint -w app/client 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/component/book-edit-form/index.tsx
git commit -m "feat: add titleSort, authorSort, publishDate fields to metadata editor"
```

---

## Task 8: Book Detail Page

**Files:**
- Modify: `app/client/src/page/book/index.tsx`

- [ ] **Step 1: Update the metadata list**

In `app/client/src/page/book/index.tsx`, remove the `addedAt` metadata entry:
```ts
  if (book !== undefined && book.addedAt) {
    metadata.push({ title: 'added', value: new Date(book.addedAt).toLocaleDateString() });
  }
```

Replace it with:
```ts
  if (book !== undefined && book.publishDate) {
    metadata.push({ title: 'published', value: book.publishDate });
  }
```

- [ ] **Step 2: Run lint**

```bash
npm run lint -w app/client 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/page/book/index.tsx
git commit -m "feat: show publishDate instead of addedAt on book detail page"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run lint across the whole project**

```bash
npm run lint 2>&1 | head -30
```

Expected: no errors or warnings.

- [ ] **Step 3: Commit any remaining fixes**

If any issues were found and fixed in Steps 1-3, commit them:

```bash
git add -p
git commit -m "fix: address any remaining lint or type issues"
```
