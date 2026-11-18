# Stop harmful comma splits of catalogue subjects — design

## Intent

`detectMetadataIssues` step 10 proposes splitting subjects on `,` as well as
`&`, `/`, `;`. That assumes a comma joins two tags ("Sci-Fi, Fantasy"). In
library-catalogue headings (Standard Ebooks, LCSH) a comma is part of one
heading: inverted names (`Carter, John (Fictitious character)`) and inverted
qualifiers (`Detective and mystery stories, English`). Every Standard Ebooks
book gets proposals that would damage its subjects; on the demo preview five of
alice's six pending fixes are these.

## Goals

- No comma split proposed for a subject that is a single catalogue heading.
- Comma splits still proposed for real tag lists ("Sci-Fi, Fantasy",
  "Science Fiction, Fantasy").
- MCP output stops showing a comma split as a no-op.

## Non-goals

- Un-inverting headings ("Detective and mystery stories, English" →
  "English detective and mystery stories"). That would be a new fix kind.
- Re-detecting proposals already stored on existing books. Readers can
  dismiss them.
- Changing the `&`, `/`, `;` rules or the auto `--` split.

## Constraints

- Detection stays total: it never throws.
- Fix keys (`field:kind:from`) are unchanged. `from` is untouched.

## Approaches (signals for "this comma is part of a heading")

- (a) the part came from a `--` heading. Misses
  "Detective and mystery stories, English", which has no `--`.
- (b) shape `X, Y (Qualifier)`: an inverted name ending in a parenthetical.
- (c) a trailing nationality or language after the comma. Needs a word list to
  maintain.
- (d) the book has any `--` subject, so it is catalogue-sourced.

**Picked: (d) + (b).** (d) covers every demo case, including the inverted
qualifier. (b) covers inverted names in books without `--`. (a) adds nothing
once (d) is in place. (c) is upkeep that (d) already covers for real catalogue
data. Accepted false negative: a real "A, B" tag list in a book that also has
`--` subjects is no longer proposed. (b) could also match a tag list that ends
in a parenthetical, such as "Sci-Fi, Fantasy (Epic)". Both cases are rare.

## Design

- `splitSubject(subject, { comma })`: when `comma` is false, split only on
  `&`, `/`, `;`.
- Compute `catalogue = subjects.some(s => splitSubdivisions(s).length > 1)`
  once per book, from the raw input subjects.
- In `proposeSplit`, allow the comma when `!catalogue && !INVERTED_NAME.test(subject)`,
  where `INVERTED_NAME` matches exactly one comma followed by a trailing
  parenthetical, e.g. `/^[^,()]+,\s*[^,()]+\([^()]*\)\s*$/`.
- Replace the comment at ~line 236, which says "Last, First" never occurs in
  subjects, with the real reasoning.
- Every `subjects-split` (proposal and auto) builds its `to` with `' | '` instead
  of `', '`, so `from → to` no longer reads as a no-op in MCP `describeFix`. The
  web UI renders `toChips` for these, except that the automatic-fix row shows
  `to` as plain text, so there it will read "England | Fiction".

## Tests (TDD, failing first)

- New: real fixture headings produce no comma proposal:
  `Holmes, Sherlock (Fictitious character)--Fiction`,
  `Detective and mystery stories, English` alongside a `--` subject,
  `Carter, John (Fictitious character)` without any `--` subject (shape rule).
- New: "Sci-Fi, Fantasy" is still proposed when the book has no `--` subject.
- New: `&` still splits in a catalogue book.
- Flip: `metadata-issues.test.ts` "only proposes … a further split of a `--` part"
  and `epub-import-pipeline.test.ts` "auto-splits `--` subjects on import …"
  currently assert the Bennet comma proposal. They change to expect none.
- Update `to` expectations to the `' | '` join (server and any client fixtures
  that model a server `to`).

## Left to the builder

- Exact regex wording, and test names.
