# Design: `useAuthorizedSrc` hook

**Date:** 2026-06-11
**Branch:** fix/cover-auth

## Problem

The JWT authentication added to HASS-ODPS protects all `/api/books/:id/cover` endpoints with Bearer token auth. Browser `<img src="...">` elements make unauthenticated GET requests — they never send the `Authorization` header — so every cover image returns HTTP 401.

Three callsites are affected:
- `app/client/src/component/cover/index.tsx`
- `app/client/src/component/book-row/index.tsx`
- `app/client/src/page/book/index.tsx`

The `Cover` component had a partial fix applied (inline `useEffect` + `apiFetch` + blob URL), but the other two callsites were missed, and the logic is not reusable.

## Solution

Extract a generic `useAuthorizedSrc` hook that accepts a URL (or null) and returns a blob URL string (or undefined) by fetching through `apiFetch`, which injects the Bearer token.

## Hook API

```ts
// app/client/src/lib/use-authorized-src.ts
useAuthorizedSrc(url: string | null): string | undefined
```

**Behaviour:**
- `null` input → returns `undefined`, no fetch is made.
- Non-null input → calls `apiFetch(url)`, converts a successful (`ok`) response body to a blob URL via `URL.createObjectURL`, and returns it.
- Non-ok responses and fetch errors leave `src` as `undefined`; the cover simply does not appear — no crash.
- When `url` changes or the component unmounts, the effect cleanup calls `URL.revokeObjectURL` on the old blob URL and clears state. The `setSrc(undefined)` call is placed in the cleanup return function (not the synchronous effect body) to satisfy the `react-hooks/set-state-in-effect` lint rule.

## Callsite Changes

### `component/cover/index.tsx`
Remove the inline `useEffect` and `useState`. Compute `url` from `bookId` and `thumbnailWidth` (null when `bookId` is null), then:
```ts
const src = useAuthorizedSrc(url);
```

### `component/book-row/index.tsx`
```ts
const coverSrc = useAuthorizedSrc(
  book.hasCover ? `/api/books/${encodeURIComponent(book.id)}/cover?width=60` : null
);
// replace raw src={`/api/...`} with src={coverSrc}
```

### `page/book/index.tsx`
```ts
const coverSrc = useAuthorizedSrc(
  book.hasCover ? `/api/books/${encodeURIComponent(book.id)}/cover?width=170` : null
);
// replace raw src={`/api/...`} with src={coverSrc}
```

## Testing

### New: `lib/use-authorized-src.test.ts`
- null URL → returns undefined, no fetch called
- non-null URL → apiFetch called with URL, blob URL created and returned
- URL change → old blob URL revoked, new fetch made
- unmount → blob URL revoked

### Updated: `component/cover/index.test.tsx`
The four existing tests mock `apiFetch` at module scope via `vi.mock('~/lib/api-fetch')`. After extracting the hook, `Cover` calls `useAuthorizedSrc` which in turn calls `apiFetch` from that same module — the mock intercepts at the module boundary and the tests pass unchanged.

### `book-row` and `page/book`
Neither has cover-specific tests today. No test changes required for those files.

## Files Changed

| File | Change |
|------|--------|
| `app/client/src/lib/use-authorized-src.ts` | New — the hook |
| `app/client/src/lib/use-authorized-src.test.ts` | New — hook tests |
| `app/client/src/component/cover/index.tsx` | Remove inline effect, use hook |
| `app/client/src/component/cover/index.test.tsx` | Verify/adjust existing tests |
| `app/client/src/component/book-row/index.tsx` | Replace raw src with hook |
| `app/client/src/page/book/index.tsx` | Replace raw src with hook |
