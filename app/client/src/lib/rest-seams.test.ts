import * as fs from 'fs';
import * as path from 'path';

/**
 * The REST/GraphQL boundary, enforced.
 *
 * Every entry here is a deliberate design decision, not a formality: the call
 * is pre-auth, or it moves bytes, or it is the auth primitive itself. Adding a
 * file to this list means asserting one of those is true of it. If your change
 * failed this test, the question is not "how do I get past it" but "why does
 * this screen need REST when the schema serves it".
 */
const SANCTIONED = new Set([
  'lib/api-fetch.ts', // POST /api/auth/refresh + the authorized-fetch wrapper
  'lib/logout.ts', // POST /api/auth/logout — pre-auth teardown
  'lib/staged-upload.ts', // POST /api/books/{replace,cover}-staging — multipart
  'lib/use-authorized-src.ts', // blob fetch of cover/thumbnail/download URLs
  'page/login/index.tsx', // POST /api/login — pre-auth
  'provider/config/provider.tsx', // GET /api/public-config — pre-auth; Query.config is authenticated
  'provider/book/hook/use-download-book.ts', // file download — binary
  'provider/upload/hook/use-upload-transport.ts', // POST /api/books/upload — XMLHttpRequest, for upload progress
]);

const SRC = path.join(__dirname, '..');

/**
 * Three forms, because the seams use three:
 *   - `apiFetch(`      — the authorized wrapper
 *   - bare `fetch(`    — pre-auth calls that must not carry a token
 *   - `new XMLHttpRequest` — the upload transport, which needs progress events
 *
 * The XHR arm matters: `use-upload-transport.ts` never calls `fetch` at all, so
 * a fetch-only regex would declare it clean while missing the single largest
 * REST surface in the app — the same blindness this assertion replaces.
 *
 * The lookbehind excludes `refetch(`/`prefetch(`; `fetchMore(` is excluded by
 * requiring the call paren immediately after `fetch`.
 *
 * No `\s*` between `fetch` and `(`: doc-comment prose like "the REST cover
 * *image* fetch (a binary endpoint...)" also matches a loose version of this
 * pattern (confirmed in `component/book-row/from-entry.tsx`). This isn't just
 * empirically true today — it's structurally enforced: `npm run lint`'s
 * `oxfmt --check` normalizes every real call expression to have no space
 * before the paren, so CI itself keeps the assumption true.
 *
 * Known blind spot, accepted deliberately: a call written across a line break
 * — `fetch\n('/api/nope')` — would evade this regex the same way it evades the
 * no-space assumption above. No such call exists in this tree and `oxfmt`
 * would not produce one, but this is a plain-text pattern, not an AST walk,
 * so a sufficiently contrived call can still slip past it.
 */
const CALL = /(?<![A-Za-z0-9_$])(?:api)?[Ff]etch\(|new\s+XMLHttpRequest/;

/**
 * Strip comments before matching, so a doc comment that *talks about* a REST
 * call — this migration has ten steps of exactly that — doesn't get flagged
 * as if it *made* one. `/\/\*[\s\S]*?\*\//g` removes block comments,
 * `/\/\/.*$/gm` removes line comments.
 *
 * Deliberate trade-off: this also strips comment-shaped text that happens to
 * live inside a string literal (e.g. a string containing `"// fetch(x)"`).
 * That is accepted on purpose — a false NEGATIVE from over-stripping is far
 * less likely here than the false POSITIVE this function exists to prevent,
 * and no real call site in this codebase hides its call inside a string.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'gql' ? [] : walk(full);
    if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) return [];
    return [full];
  });

it('confines REST calls to the sanctioned seams', () => {
  const offenders = walk(SRC)
    .filter((f) => CALL.test(stripComments(fs.readFileSync(f, 'utf-8'))))
    .map((f) => path.relative(SRC, f))
    .filter((rel) => !SANCTIONED.has(rel))
    .sort();

  expect(offenders).toEqual([]);
});

it('every sanctioned seam still exists and still makes a call', () => {
  // Guards the other direction: a stale allow-list entry silently widens the
  // assertion, and a seam that stopped calling REST should be removed from it.
  for (const rel of SANCTIONED) {
    const full = path.join(SRC, rel);
    expect(fs.existsSync(full), `${rel} is listed but missing`).toBe(true);
    expect(
      CALL.test(stripComments(fs.readFileSync(full, 'utf-8'))),
      `${rel} no longer calls REST`
    ).toBe(true);
  }
});
