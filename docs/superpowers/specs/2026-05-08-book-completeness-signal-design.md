# Book Data Completeness Signal

## Problem

`GET /api/books` returns a summary of each book, stripping fields that are expensive to include in bulk responses. Currently `description` is stripped; `identifiers`, `publisher`, and `subjects` will be stripped soon.

When `useFetchBookList` runs, books land in the shared `bookList` context with those fields absent. Because `useBook` only triggers `useFetchBook` when `bookList[bookId] === undefined`, it treats a summary-only book as "already loaded" and never fetches the complete data — leaving fields missing on any UI that needs them (book detail page, edit page).

## Solution

Add a `completeBookIds: Set<string>` to the BookProvider context. A book is marked complete only after `useFetchBook` succeeds. `useBook` extends its trigger condition to also fetch when a book exists but is not in the complete set. Scan and upload hooks clear the set so books are re-fetched after library changes.

No changes to the `Book` type. No changes to any components.

## Files Changed (6)

### `client/src/provider/book/context.ts`

Add three new members to `BookContext`:

```ts
completeBookIds: Set<string>;
setBookComplete: (bookId: string) => void;
clearCompleteBookIds: () => void;
```

Default values in `createContext`: `new Set()`, `() => {}`, `() => {}`.

### `client/src/provider/book/provider.tsx`

```ts
const [completeBookIds, setCompleteBookIdsRaw] = useState(new Set<string>());

const setBookComplete = useCallback((bookId: string) => {
  setCompleteBookIdsRaw((prev) => new Set([...prev, bookId]));
}, []);

const clearCompleteBookIds = useCallback(() => {
  setCompleteBookIdsRaw(new Set());
}, []);
```

Spread into `Context.Provider value`.

### `client/src/provider/book/hook/use-fetch-book.ts`

Destructure `setBookComplete` from context. In the `try` block, after `setBookList`, call:

```ts
setBookComplete(bookId);
```

### `client/src/provider/book/hook/use-book.ts`

Destructure `completeBookIds` from context. Change the `useEffect` condition:

```ts
// before
bookList[bookId] === undefined

// after
bookList[bookId] === undefined || !completeBookIds.has(bookId)
```

Add `completeBookIds` to the `useEffect` dependency array.

Return value behavior for incomplete books (exists in `bookList` but absent from `completeBookIds`):
- First render (before `useEffect` fires): returns `[book, false, false, undefined]` — shows summary data immediately
- While fetching complete data (`loadingByBookId[bookId]` = true): returns `[book, true, false, undefined]`
- After fetch completes: returns `[book, false, false, undefined]` with full data

### `client/src/provider/book/hook/use-scan-library.ts`

Destructure `clearCompleteBookIds` from `useContext(Context)`. In the `try` block, call `clearCompleteBookIds()` before `fetchBookList()`.

### `client/src/provider/book/hook/use-upload-book-list.ts`

Same as `use-scan-library.ts`.

## Data Flow

```
useFetchBookList() runs
  → books in bookList, NOT in completeBookIds

useBook(bookId) renders
  → book exists but !completeBookIds.has(bookId)
  → useEffect triggers useFetchBook(bookId)
  → returns [book, false, undefined] initially (summary data)
  → returns [book, true, undefined] while loading
  → setBookComplete(bookId) called on success
  → returns [book, false, undefined] with full data

useScanLibrary() / useUploadBookList() succeed
  → clearCompleteBookIds() called
  → fetchBookList() runs, refreshes summaries
  → next useBook() call for any book triggers full re-fetch
```

## Edge Cases

- **Double fetch prevention**: `useFetchBook` already guards via `loadingByBookId[bookId]`. Two components mounting for the same book fire only one request.
- **Failed fetch**: book stays absent from `completeBookIds`; next render re-triggers (existing retry behavior).
- **Regular list refresh** (not scan/upload): `completeBookIds` is NOT cleared — previously complete books are not re-fetched unnecessarily.
- **Direct navigation** (no prior list fetch): `useFetchBook` runs first; book lands in both `bookList` and `completeBookIds` simultaneously. No extra fetch.
