# Step 10 — Sweep: delete `BookProvider`, make the REST contract real

**Parent spec:** `docs/superpowers/specs/2026-08-03-apollo-client-migration-design.md` (§9, row 10)
**Status:** approved 2026-08-24
**Predecessors:** steps 6-9 (book detail/series, book edit, progress, upload/replace)

This is the LAST step of spec 2.

---

## 1. Scope

**In scope**

- Delete the seven dead `provider/book` hooks, `BookContext`, `BookProvider`, and the
  REST-era type surface they were the last consumers of
- Simplify `useBookListFilter` to pure URL-derived state — the one blocker to deleting
  the provider (§3.1)
- Delete `lib/cover-url.ts`
- Correct the parent spec's REST-seam contract, which is wrong in four places (§4)
- Consolidate the two duplicated logout call sites into one helper, best-effort (§5)
- Close the silent-re-login hole that best-effort logout would otherwise open (§5.2)
- Replace the `apiFetch`-only sweep assertion with one that also catches bare `fetch(` (§6)

**Explicitly out of scope**

- Any further GraphQL migration. Every screen is already migrated; this step removes
  what migration left behind.
- Moving `provider/config`'s `/api/public-config` call to GraphQL. It is pre-auth (the
  password-reset page renders the library name before login) and `Query.config` is
  authenticated. It stays REST and becomes a NAMED seam.
- Moving `MetadataFix` out of `provider/book/type.ts`. Four upload-side files import it
  from there (§3.3). The coupling is odd but harmless, and relocating a type consumed by
  a provider this step is not otherwise touching buys nothing.

---

## 2. Decisions

**D1 — Correct the seam contract AND consolidate logout.** The alternative was to ship
the assertion as originally specified and record the inaccuracies for later. Rejected:
an assertion blind to four of the sites it purports to govern is worse than none,
because it reads as coverage. See §4 for what is actually wrong.

**D2 — Logout unifies on BEST-EFFORT.** A failed `POST /api/auth/logout` no longer blocks
the local teardown: the token is cleared and the user is redirected regardless.

This is a deliberate behaviour change, and it is an improvement on a currently-broken
path. `useLogout` returns a 4-tuple `[logout, loading, error, errorMessage]`; its only
consumer (`page/user/index.tsx:18`) destructures **two**. So today a failed logout sets
error state that nothing renders, shows no message, performs no redirect, and leaves the
user on the page with no feedback at all.

Rejected: unifying on fatal. The password-change path must end the session regardless —
the password has already changed by then — so a throwing helper would strand that user
with a changed password, a live session, and an error.

**D3 — Suppress exactly one silent refresh on logout.** Required by D2; see §5.2. Without
it, D2 is a security-adjacent regression rather than an improvement.

---

## 3. Deleting the dead cluster

### 3.1 The blocker, and why it dissolves

`BookProvider` cannot be deleted while anything reads `BookContext`. After step 9 exactly
one live screen still does: `page/library` calls `useBookListFilter`, which reads
`bookListFilter`/`setBookListFilter` from the context.

But read what the hook returns (`provider/book/hook/use-book-list-filter.ts:66`):

```ts
return [filterFromSearchParams(searchParams), setFilter];
```

It returns the **URL-derived** value. The context copy is never returned to anyone; it
exists only so the hook's own effect can compare against it and skip a redundant write.
`setBookListFilter` writes a value whose only reader is that comparison.

This is the third instance of the same pattern in this migration — a cache kept faithfully
updated long after its last real reader disappeared (step 8's `renameProgressKey`, step
9's `bookList`, now this). The URL was always the source of truth.

The simplification:

```ts
export const useBookListFilter = (): [BookListFilter, (f: BookListFilter) => void] => {
  const [searchParams, setSearchParams] = useSearchParams();
  const setFilter = useCallback(
    (f: BookListFilter) => setSearchParams(filterToSearchParams(f), { replace: true }),
    [setSearchParams]
  );
  return [filterFromSearchParams(searchParams), setFilter];
};
```

The effect, the context read, and `filtersEqual` all go. `filterFromSearchParams` and
`filterToSearchParams` stay — both are still needed by the simplified hook itself.

Note `filterToSearchParams` carries an `export` that, verified, no file outside
`use-book-list-filter.ts` consumes. Narrowing it to module-private is correct only if no
test imports it; check before changing, and leave the `export` alone if one does. This is
a tidy-up, not a requirement of this step.

**Behaviour to verify, not assume:** the removed effect wrote context state on every
`searchParams` change. Since nothing rendered from that state, removing it should be
invisible — but `page/library`'s filter round-trip (type in the search bar → URL updates →
grid refetches with the new filter) must be covered by a test that would fail if the URL
write were dropped.

### 3.2 What is deleted

Seven hooks, verified at zero live callers by direct trace:

`use-book.ts`, `use-fetch-book.ts`, `use-book-list.ts`, `use-standalone-book-list.ts`,
`use-book-list-items.ts`, `use-upload-book-list.ts`, `use-fetch-book-list.ts`

Plus `provider/book/context.ts`, `provider/book/provider.tsx`, their tests, their barrel
exports, and `App.tsx`'s `<BookProvider>` mount.

Plus `lib/cover-url.ts` — zero importers (its only mentions are two doc comments in
`component/cover-stack` and `component/cover` explaining what the GraphQL replacement does
instead; those comments stay, their subject does not).

`provider/book/` survives as a directory of GraphQL-backed hooks with no provider of its own —
16 hook files, 15 of them exported from `hook/index.ts` (`use-scan-progress.ts` is deliberately
module-private, consumed only by `use-scan-library.ts`), which is the ~15 the parent spec and
the brief quote. That is the correct end state, not a compromise: none of them need shared state.

### 3.3 The type surface

`provider/book/type.ts` survives, **trimmed**. `BookListFilter` is imported by
`page/library`, `page/library/to-library-filter.ts`, `component/search-bar`, and
`use-search-suggestions`. `MetadataFix` is imported by `provider/upload/hook/use-upload-queue.ts`,
`component/upload-item`, `component/fix-review`, and `control/upload-replace-modal`.

The REST-era types whose last consumers are the deleted hooks go with them: `BookList`,
the REST-era `Book`, `Series`, `DisplayUnit`, `UploadResult`, `UploadFileResult`. The plan
enumerates the exact set; `tsc --noEmit` is the arbiter.

> **Corrected at the final sweep:** `UploadFileResult` did NOT go — it is live. See §11.

---

## 4. The REST seam contract, corrected

The parent spec's §9.1 lists four seams. It is wrong in four ways:

1. **Seam 1 claims `lib/api-fetch.ts` holds "login, logout, refresh".** Only refresh does.
   `POST /api/login` is in `page/login/index.tsx:19`.
2. **Logout is in two other files**, duplicated: `provider/auth/hook/use-logout.ts:16` and
   `provider/user/hook/use-change-my-password.ts:109`.
3. **`use-download-book.ts` uses `apiFetch` and is named nowhere** (flagged at step 9's
   sweep). Seam 2 covers `lib/use-authorized-src.ts`'s blob fetches, which is a different
   call.
4. **`provider/config/provider.tsx`'s `fetch('/api/public-config')`** — found at step 9's
   sweep, already recorded in §9.1 as a known gap.

The corrected list — eight seams:

| # | Seam | Call | Why it stays REST |
|---|---|---|---|
| 1 | `lib/api-fetch.ts` | `POST /api/auth/refresh` + the authorized-fetch wrapper | the auth primitive itself |
| 2 | `page/login/index.tsx` | `POST /api/login` | pre-auth |
| 3 | `lib/logout.ts` *(new, §5)* | `POST /api/auth/logout` | pre-auth teardown |
| 4 | `provider/config/provider.tsx` | `GET /api/public-config` | pre-auth; `Query.config` is authenticated |
| 5 | `lib/use-authorized-src.ts` | blob fetch of cover/thumbnail/download URLs | binary |
| 6 | `provider/book/hook/use-download-book.ts` | file download | binary |
| 7 | `provider/upload/hook/use-upload-transport.ts` | `POST /api/books/upload` | multipart + XHR progress |
| 8 | `lib/staged-upload.ts` | `POST /api/books/{replace,cover}-staging` | multipart staging |

Both the parent spec's §9.1 and this document carry the corrected list.

---

## 5. Logout

### 5.1 One helper, best-effort

`lib/logout.ts`:

```ts
export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Best-effort: the server-side cookie clear is not allowed to block the
    // local teardown. See §5.2 for what makes that safe.
  }
  markLoggedOut();
  clearToken();
  window.location.href = '/login';
}
```

`useLogout` narrows from `[logout, loading, error, errorMessage]` to `[logout, loading]`.
That is not a breaking change for its only consumer: `page/user/index.tsx:18` already
destructures exactly those two, which is why a failed logout is currently silent. The
dropped members had no renderer to lose. `use-change-my-password` calls the same helper in
place of its inline try/catch/clearToken/redirect block.

### 5.2 The hole best-effort would otherwise open

`provider/auth/provider.tsx:46-56` performs a mount-time silent refresh: *"with no valid
token, silently try one refresh — the httpOnly refresh cookie may still be good (keeps
logins across browser restarts)"*.

So if the logout POST fails, the refresh cookie survives. Best-effort clears the local
token and lands the user on `/login` — where that bootstrap immediately refreshes against
the still-valid cookie and signs them straight back in. The user clicked Log out and is
logged in.

`markLoggedOut()` writes a one-shot marker that `AuthProvider` consumes on mount and, if
present, skips its silent refresh exactly once.

- **`sessionStorage`, not a module variable** — `window.location.href` is a full document
  navigation, so nothing in memory survives it.
- **One-shot, consumed on read** — it can never wedge a real login. A user who logs out and
  immediately logs back in consumes the marker on the `/login` mount, well before the new
  session exists.
- **Per-tab, and the cross-tab path is a hole, not a mitigation.** `sessionStorage` is scoped
  to one tab, so only the logging-out tab is ever marked. Cross-tab propagation does not cover
  the gap — it *opens* it. `clearToken()` removes the localStorage key; a sibling tab's storage
  listener (`provider/auth/provider.tsx`) fires, `valid` flips false, and that tab's bootstrap
  effect re-runs — reading its OWN, unmarked `sessionStorage`. So if the logout POST failed,
  the sibling refreshes against the still-live cookie, succeeds, `setToken()`s, and the
  original tab (already on `/login`, marker spent) adopts the new token through the same
  listener and is signed in again. See §12 for the preconditions and the natural closures.
- **Under `<StrictMode>` the marker must survive a double-invoke.** `main.tsx` wraps the app in
  `<StrictMode>`, so in development React runs the bootstrap effect setup → cleanup → setup.
  The first setup consumes the (destructive) marker; a second setup that re-asks
  `consumeLoggedOutMark()` gets `false` and refreshes, i.e. no suppression at all in dev. The
  provider therefore latches the consumed result in a ref that is cleared only when `valid`
  is observed `true` — a genuine re-arm is always preceded by a `valid` transition to true; a
  StrictMode double-invoke never is. Both halves are pinned by `<StrictMode>`-wrapped tests.

---

## 6. The assertion

Today's sweep check greps `apiFetch`/`api-fetch`. All four stray sites use bare `fetch(`,
so it cannot see any of them.

The replacement scans `app/client/src` for **both** `apiFetch(` and bare `fetch(`,
allow-lists exactly the eight files in §4, and fails on anything else. It excludes test
files, and excludes the identifiers that merely contain the substring (`refetch`,
`fetchMore`, `prefetch`).

It lives as a client test so it runs in the ordinary suite rather than as a manual step.

**Seen-to-fail is mandatory.** Add a deliberate stray `fetch(` somewhere outside the
allow-list, watch the assertion trip, then remove it. An allow-list assertion that has
never been observed failing is indistinguishable from one whose regex never matches.

---

## 7. Testing

**Deletions:** `tsc --noEmit` is the real gate for missed importers. Beyond it, the sweep
greps for each deleted symbol and asserts zero hits.

**`useBookListFilter`:** `page/library`'s filter round-trip — set a filter, assert the URL
updates and the grid refetches with it; and mount with a filter already in the URL and
assert it is read. Both must fail if the URL write is dropped.

**Logout:** three tests. A failed POST still clears the token and redirects. The marker
suppresses exactly one silent refresh — and the one after it is NOT suppressed. A login
immediately following a logout still succeeds.

**The assertion:** seen-to-fail, per §6.

**Gates:** server + client suites, `test:cost`, both lints, codegen and SDL in sync.

---

## 8. Risks and stop conditions

### 8.1 The logout change is the only real risk

It touches auth — code this branch's suite was never built around — and alters behaviour on
a path every user hits. Its three tests (§7) are not optional.

**Stop condition:** if the one-shot marker cannot be made to reliably suppress exactly one
refresh (for instance because the bootstrap runs before any code that could consume it),
stop and report rather than shipping best-effort logout with the re-login hole open. D2
without D3 is a regression, not an improvement.

### 8.2 Deleting a provider is broad but shallow

`BookProvider` is mounted in `App.tsx` and its context is read by seven files, all of which
this step deletes. The blast radius is wide in file count and near-zero in behaviour —
provided §3.1's simplification is correct. If `useBookListFilter` turns out to depend on the
context for something the trace missed, the provider stays and only the six other hooks go.

### 8.3 An allow-list assertion invites drift

A future legitimate seam will fail CI, and the tempting fix is to widen the list without
thinking. The assertion's failure message must say what the list is FOR — that a new entry
is a design decision about the REST/GraphQL boundary, not a formality.

---

## 9. Definition of done

- Seven dead hooks, `BookContext`, `BookProvider`, and `lib/cover-url.ts` deleted; the
  `<BookProvider>` mount removed from `App.tsx`.
- `useBookListFilter` reads and writes only the URL; `page/library` unchanged in behaviour.
- One logout helper; both former call sites use it; a failed POST still ends the session.
- The silent-refresh suppression works and is tested for both the suppressed and the
  following non-suppressed case.
- The sweep assertion covers bare `fetch(` and has been seen to fail.
- Both specs carry the corrected eight-seam list.
- All gates green.

---

## 10. Known behaviour changes

1. **A failed logout now redirects instead of doing nothing visible.** Today it sets error
   state its only consumer does not render. This is a fix, not a regression — but it is a
   change.
2. **The first silent refresh after a logout is skipped.** Only the first; a normal cold
   start with a valid cookie is unaffected.
3. **Filter state no longer round-trips through React context.** Unobservable if §3.1's
   trace is right, which is why §7 requires the round-trip test.

---

## 11. Outcome — recorded 2026-08-24, at completion

All three behaviour changes in §10 shipped exactly as predicted; none were revised at the
sweep.

1. **Best-effort logout.** `lib/logout.ts` ships `logout()` exactly as drafted in §5.1: POST,
   swallow the failure, `markLoggedOut()`, `clearToken()`, redirect. `useLogout` narrowed to
   `[logout, loading]` (commit `63095c5b`); `use-change-my-password` now calls the same
   `performLogout()` in place of its own inline teardown. A round-1 review pass (commit
   `a04d20b5`) found the consolidation had dropped the only assertion on the POST's actual
   URL/method — added back in `lib/logout.test.ts`, and *seen to fail*: the commit message
   records it was "verified to trip on a temporarily mutated URL/method, then reverted".
2. **One-shot silent-refresh suppression.** Shipped as `markLoggedOut`/`consumeLoggedOutMark`
   in `lib/logout.ts`, consumed by `provider/auth/provider.tsx`'s bootstrap effect. One defect
   was found and fixed in the same step, not deferred: commit `98f8d157` — the skip branch that
   consumes the marker returned early without the cleanup the refresh path registers, so
   `bootstrapped.current` stayed `true` for the life of the mount. A tab that logs out, reloads
   to `/login` (skip fires), logs back in via SPA `setToken` (no remount), and later loses its
   token again (cross-tab clear, failed proactive refresh, expiry) would never re-arm its
   silent bootstrap refresh short of a full page reload. Fixed by returning an equivalent
   cleanup from the skip branch.

   **A second defect, found only by the final whole-step review: that very fix broke the
   suppression in development.** With a cleanup now returned from the skip branch,
   `<StrictMode>`'s setup → cleanup → setup sequence reset `bootstrapped.current` between the
   two setups, and the second setup re-asked the *destructive* `consumeLoggedOutMark()` — which
   the first setup had already consumed — got `false`, and refreshed. So every `npm run dev`
   session had no suppression at all: precisely the behaviour §5.2 exists to guarantee, absent
   in the one environment a developer would check it in. Production was unaffected (React does
   not double-invoke there), which is why no task-scoped review caught it — and why the existing
   tests, all rendering without `<StrictMode>`, could not.

   Fixed by latching the consumed result in a second ref (`loggedOutSkip`) that the skip branch
   sets and that is cleared only on a run where `valid === true`. That is the discriminator: a
   genuine re-arm (SPA login, then a later token loss) is always preceded by a `valid`
   transition to true; a StrictMode double-invoke is two synchronous setups with `valid`
   unchanged, so it never clears the latch. Neither behaviour is traded for the other.

   `provider/auth/provider.test.tsx` carries five tests exercising this directly:
   skip-on-armed-marker; the same skip wrapped in `<StrictMode>` (seen to fail against the
   pre-fix code: `expected "vi.fn()" to not be called at all, but actually been called 1 times`,
   with the recorded call `["/api/auth/refresh", {"method": "POST"}]`);
   refresh-still-happens-on-the-next-mount (one-shot, not permanent);
   re-arm-after-a-post-logout-mount-later-loses-its-token (the exact scenario `98f8d157` fixed,
   unmodified by the StrictMode fix); and that same re-arm scenario wrapped in `<StrictMode>`,
   which pins that the dev fix did not buy suppression at the re-arm's expense.

   **`markLoggedOut()` is now guarded too.** It ran *before* `clearToken()` in `logout()`, so a
   `sessionStorage` `SecurityError` (blocked/partitioned storage) aborted the whole teardown:
   no token clear, no redirect — and in the password-change path the rejection surfaced as a
   FAILED password change that had in fact succeeded. Wrapped in the same swallow-and-continue
   `try/catch` the POST already had, so the helper is genuinely unconditional. The marker is an
   optimisation guarding a failed-POST edge case; the teardown is the contract.
3. **Filter state off React context.** Shipped as drafted in §3.1 — `useBookListFilter` returns
   `[filterFromSearchParams(searchParams), setFilter]` with no context read or write. The
   round-trip test §7 required landed in `page/library/index.test.tsx` (commit `bcbeca77`,
   +101 lines), and one `use-book-list.test.tsx` test that had driven `BookContext`'s filter
   through the hook's now-removed setter was rewritten to drive `use(Context)` directly instead
   — the one adjustment the plan did not foresee, though it is test-only and changes no
   production behaviour.

**The REST-seam assertion — seen-to-fail per §6, plus two more real false-positive findings
along the way.** §6's literal requirement — "a deliberate stray `fetch(` somewhere outside the
allow-list, watch the assertion trip, then remove it" — was done exactly as specified (task-5
report): `fetch("/api/nope")` appended to `page/library/to-library-filter.ts`, the assertion
observed to fail naming that exact file (`AssertionError: expected [ 'page/library/to-
library-filter.ts' ] to deeply equal []`), the probe reverted, `git diff` confirmed clean, and
the assertion re-observed passing (2/2).

On top of that required probe, building the assertion surfaced two independent real false
positives against content already in the tree — neither planted, both fixed before the
behaviour they exposed could ship as a bug:

- Building the brief's own regex (with `\s*` before the call paren) against the current tree,
  before any commit: it matched doc-comment prose in `component/book-row/from-entry.tsx` —
  "...the REST cover *image* fetch (a binary endpoint..." — a file with no REST call at all.
  Fixed by dropping the `\s*` (commit `508a35e4`), verified safe because no real call site in
  the tree puts whitespace before its call paren.
- A round-1 review finding (commit `dd91d93a`): even with the tightened regex, comment prose
  with no space before the paren — precedent already in the tree at
  `provider/upload/hook/use-upload-transport.test.tsx:68`'s "a real `fetch('/api/auth/refresh')`
  when no..." — would still match in a non-test file, since only `*.test.tsx` exclusion, not
  comment-awareness, saved that particular instance. Fixed by stripping block/line comments
  before matching, with a proof appended showing the comment form no longer trips the assertion.

The final `rest-seams.test.ts` documents two remaining blind spots deliberately, not as
oversights: a space before the call paren (`fetch (url)`, prevented by `oxfmt --check` in CI,
which normalizes every real call to have no such space) and a call broken across a line
(`fetch\n(url)`, no instance exists and `oxfmt` would not produce one, but a plain-text pattern
cannot rule it out the way an AST walk could).

**One §3.3 claim was wrong and is corrected here.** `UploadFileResult` was listed among the
REST-era types that "go with" the deleted hooks. It did not go, and should not have: it is
still defined at `provider/book/type.ts:12` and still imported by
`provider/upload/hook/use-upload-transport.ts:7`, which parses `POST /api/books/upload`'s
response into it (seam 7 in §4 — multipart XHR, deliberately still REST). `tsc --noEmit` was
the arbiter as §3.3 said it would be, and it kept the type; only the prose was stale. Every
other name in that list did go.

**Test counts.** Server: 2041/2041 before and after — this step touched no server code, so §7's
"server + client suites" gate exercised a suite with zero server-side change to verify. Client:
1119/1119 (step 9's end state) → 1082/1082, a net decrease of 37 despite four new logout tests,
a rewritten filter round-trip test, and the two-test `rest-seams.test.ts` file, because the
`d5825419` deletion commit alone removed 2010 lines including six hook test files
(`use-book-list.test.tsx`, `use-book.test.tsx`, `use-fetch-book-list.test.tsx`,
`use-fetch-book.test.tsx`, `use-standalone-book-list.test.tsx`, `use-upload-book-list.test.tsx`)
and `cover-url.test.ts`.

**Nothing in this step's own plan was found wrong at the sweep.** The one thing the *parent*
spec's §9.1 had wrong (four inaccuracies, listed in this document's §4) was exactly what this
step set out to correct, and did. The `98f8d157` fix and the two `rest-seams.test.ts` tuning
commits are not plan failures — §5.2 and §6 explicitly anticipated needing exactly this kind of
correction (a stop condition for the marker, seen-to-fail for the assertion) and both fired as
designed, just against real bugs/content instead of synthetic ones.

Spec 2 (the Apollo client migration) is now **COMPLETE, 10 of 10.**

---

## 12. Known follow-up, deliberately not fixed here

**A failed logout POST with a second tab open can restore the session.** The one-shot marker
(§5.2) lives in `sessionStorage`, which is per-tab, so only the tab that ran `logout()` is
marked. The sequence:

1. Tab B is mounted with a valid token; its bootstrap effect early-returned on `valid`.
2. Tab A logs out. `lib/logout.ts` → `clearToken()` removes the shared localStorage key. Tab
   B's storage listener (`provider/auth/provider.tsx`) fires, `valid` flips false, and its
   `[valid]` bootstrap effect re-runs.
3. Tab B reads its OWN `sessionStorage` — never marked — so nothing suppresses it and it calls
   `refreshAccessToken()`.
4. If Tab A's logout POST failed, the refresh cookie is still live: the refresh succeeds,
   `setToken()` writes a fresh token, and Tab A — sitting on `/login` with its marker already
   spent — adopts it through the same storage listener and is authenticated again.
   `page/login/index.tsx` has no redirect-if-authenticated guard, so the user is shown a login
   form while `AuthContext` reports them signed in.

**Preconditions: both (a) the logout POST failed AND (b) a second tab is open.** This is NOT a
regression — before this step, a failed POST left the user fully signed in on the original tab
with no feedback at all (§2 D2), which is strictly worse. It is a hole this step narrowed
rather than closed, so it is recorded, not silently inherited.

**Natural closures, neither implemented here:** a redirect-if-authenticated guard on `/login`
(cheap, and it also fixes the contradictory UI independently of logout), or a cross-tab logout
broadcast — a `BroadcastChannel` or a dedicated localStorage key — so a sibling tab learns the
logout was intentional and suppresses its own bootstrap refresh. The second is the real fix;
the first makes the symptom non-confusing. Deciding between them is a design question about
whether "log out" means this tab or this browser, and that belongs to a step that owns auth.

**A stale `component/cover` doc comment, found and FIXED at the final sweep.** `CoverProps.src`
claimed the prop "now has two sources (a server-built `Book.thumbnailUrl` off GraphQL, and
`coverUrl()` + `withTargetUser()` off REST)". `coverUrl()` — `lib/cover-url.ts` — was deleted by
this very step (§3.2), so the sentence describes a choice that no longer exists; `CoverStack`,
the sole production caller, passes `hasCover ? thumbnailUrl : null` and nothing else does. §3.2
had explicitly predicted "those comments stay, their subject does not", which is exactly the
trap: the comment survived and became false. Corrected in place. **`component/cover-stack`'s
mention was checked and deliberately left alone** — it names `coverUrl()` as a *negation* ("no
`coverUrl()`/`withTargetUser()` involved"), which stays true after the deletion.

**`consumeLoggedOutMark()`'s storage READ is still unguarded (`lib/logout.ts:21-25`).** The
final fix wave wrapped `markLoggedOut()`'s `sessionStorage.setItem` in a swallow-and-continue
`try/catch` (§11), but left the matching read/remove pair alone as out of its scope. Under
blocked or partitioned storage `sessionStorage.getItem`/`removeItem` throw a `SecurityError`
just as `setItem` does.

**This is worse than the write-side bug it mirrors, despite being lower probability.** The
write-side exposure was confined to the logout and password-change flows and was recoverable —
reload or retry. This one fires on **every cold mount with no valid token**, from inside
`provider/auth/provider.tsx`'s bootstrap effect near the app root. An uncaught throw in a React
effect propagates to the nearest error boundary or, absent one, can blank the whole app on
initial load. A user with third-party/partitioned storage restrictions would see a broken app,
not a broken logout.

**The fix is the same one-line `try/catch` §11 already proved on the write side**, and the
fallback must be stated explicitly because the tempting default is the wrong one: **a failed
read returns `false` — "no marker", refresh normally.** Suppression is an *optimisation*
guarding a failed-POST edge case; a storage failure must never be able to break a normal cold
start. Defaulting to `true` (suppress on error) would trade a rare, already-narrow re-login
hole for a permanently broken "keep me logged in across browser restarts" on every affected
browser. Pre-existing, not introduced by this step, and it did not block the merge — recorded
here because the fix wave's own report lives under `.superpowers/sdd/`, which is deleted when
this step closes.

**A second dead REST cover-URL builder, found and DELETED at the final sweep.**
`router/path-internal.ts`'s `cover(bookId)` builder (returning `/api/books/<id>/cover`) and its
`router/path.ts` re-export had zero callers anywhere in `app/client/src`, tests included — the
twin of the `lib/cover-url.ts` this step deleted, and the same class as `provider/book/util.ts`.
`rest-seams.test.ts` structurally cannot see it: the assertion matches *call expressions*, not
URL *construction*, so a dead builder that nobody calls is invisible to it by design. Deleting
it also emptied `path-internal.ts`'s sole `// Server` section header, which went with it.


**Stale present-tense claims in `component/library-switcher/index.tsx:20,28,36`.** These
comments assert, in the present tense, facts that this step made false:

- Line 20: "As of Task 9, `useFetchBookList` has ZERO live callers" (`useFetchBookList` — i.e.
  `use-fetch-book-list.ts` — is not merely zero-caller now, it no longer exists; deleted by
  this step, §3.2).
- Line 28: "`useFetchBookList`'s only remaining importers are `use-book-list.ts` and
  `use-upload-book-list.ts`" — both named files are also deleted by this step.
- Line 36: references "`useFetchBookList`'s old dead-404 branch" — the referent is gone.

This is out-of-scope for this step's own file list and outside the CONTROLLER ADDITIONS folded
in from Task 4's review (which covered exactly `provider/book/util.ts` and the
`test-utils.tsx:146` comment, nothing in `component/library-switcher`). Task 4 set the
precedent this step follows: flag out-of-list stale content for a future task rather than
silently touch it. Recorded here, not just in the SDD ledger, because the ledger for this step
is deleted once the step closes and this is the one place still readable afterward.

**Not the same finding as the four accurate-provenance comments** at
`use-current-library-id.ts:42`, `use-with-target-user.ts:18,31`, and `graphql/library.ts:180`
— those are past-tense notes explaining where current behaviour was re-homed FROM, remain true
as written, and should NOT be touched by whoever picks up this follow-up.
