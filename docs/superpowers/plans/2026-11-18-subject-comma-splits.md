# Subject Comma Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `detectMetadataIssues` proposing comma splits of library-catalogue subject headings, and make a split's `to` text read differently from its `from`.

**Architecture:** Step 10 of `app/server/utils/metadata-issues.ts` gets a per-book `catalogue` flag (any subject contains a `--` subdivision) and a per-subject inverted-name shape test. Either one turns off only the comma separator in `splitSubject`. All `subjects-split` issues build `to` with `' | '`.

**Tech Stack:** TypeScript, Jest (server).

**Spec:** `docs/superpowers/specs/2026-11-18-subject-comma-splits-design.md`

## Global Constraints

- Detection stays total: never throws for any input.
- Fix keys are `field:kind:from`. `from`, `fromChips` and `toChips` semantics are unchanged.
- `&`, `/`, `;` splitting and the auto `--` split are unchanged, apart from the `to` join.
- Focused tests only, from `app/server`: `npx jest utils/metadata-issues.test.ts services/epub-import-pipeline.test.ts`. Run `npm run lint` from the repo root. CI runs the full suite.
- Run `git branch --show-current` (expect `fix-subject-comma-splits`) before committing.

## Review Focus

- A catalogue book whose `--` part still contains `&` (e.g. `Arts & crafts--Fiction`): the `&` proposal must still fire for the part. Test in Task 1.
- An inverted name with no `--` in a non-catalogue book (`Carter, John (Fictitious character)` on its own) must not be split. Test in Task 1.
- A tag list next to a non-`--` subject (`Sci-Fi, Fantasy` + `Horror`) must still be proposed. Test in Task 1.
- Non-string or empty entries in `subjects`: the `catalogue` check must not throw. The existing "is total" tests cover the undefined-array case. Make `catalogue` use the same guarded `subjects` array.
- A heading with two commas and a parenthetical (`Smith, John, 1900- (Fictitious character)`) does not match the shape rule. It is only protected in catalogue books, which is accepted; no test.

---

### Task 1: Heading-aware comma rule

**Files:**
- Modify: `app/server/utils/metadata-issues.ts` (comment ~236-242, `splitSubject` ~253, step 10 ~457-520)
- Test: `app/server/utils/metadata-issues.test.ts`, `app/server/services/epub-import-pipeline.test.ts`

**Interfaces:**
- Produces: `splitSubject(subject: string, opts: { comma: boolean }): string[]` (module-private); `INVERTED_NAME: RegExp` (module-private).

- [ ] **Step 1: Write the failing tests** in `metadata-issues.test.ts`, next to the existing compound-subject tests:

```ts
const proposals = (issues: MetadataIssue[]) =>
  issues.filter((i) => i.kind === 'subjects-split' && !i.autoEligible);

it('does not comma-split an inverted name heading from a "--" subject (Standard Ebooks)', () => {
  const issues = detectMetadataIssues({
    ...base,
    subjects: ['Holmes, Sherlock (Fictitious character)--Fiction'],
  });
  expect(proposals(issues)).toEqual([]);
});

it('does not comma-split an inverted qualifier in a book with "--" subjects', () => {
  const issues = detectMetadataIssues({
    ...base,
    subjects: [
      'Holmes, Sherlock (Fictitious character)--Fiction',
      'Private investigators--England--Fiction',
      'Detective and mystery stories, English',
    ],
  });
  expect(proposals(issues)).toEqual([]);
});

it('does not comma-split an inverted name with a qualifier even without "--" subjects', () => {
  const issues = detectMetadataIssues({
    ...base,
    subjects: ['Carter, John (Fictitious character)', 'Science fiction'],
  });
  expect(proposals(issues)).toEqual([]);
});

it('still proposes a comma tag list in a book with no "--" subjects', () => {
  const issues = detectMetadataIssues({ ...base, subjects: ['Sci-Fi, Fantasy', 'Horror'] });
  expect(proposals(issues).map((i) => i.toChips)).toEqual([['Sci-Fi', 'Fantasy']]);
});

it('still proposes "&" splits in a book with "--" subjects', () => {
  const issues = detectMetadataIssues({ ...base, subjects: ['Arts & crafts--Fiction'] });
  expect(proposals(issues)).toMatchObject([
    { from: 'Arts & crafts', toChips: ['Arts', 'crafts'] },
  ]);
});
```

Rewrite the existing test `only proposes (never auto-applies) a further split of a "--" part` as `auto-splits a "--" inverted-name subject without proposing a comma split`. Keep the `splitIssues[0]` assertion, and change the expected length to `1`. Remove the `splitIssues[1]` assertion and its comment.

In `epub-import-pipeline.test.ts`, rename `auto-splits "--" subjects on import, keeping a further comma split as a proposal` to `auto-splits "--" subjects on import without proposing comma splits of headings`. Keep the `result.book.subjects` and `applied` assertions, and change the last assertion to `expect(proposals).toEqual([])`.

- [ ] **Step 2: Run them and confirm they fail**

Run (from `app/server`): `npx jest utils/metadata-issues.test.ts services/epub-import-pipeline.test.ts`
Expected: FAIL. The first three new tests and the two rewritten tests fail because comma proposals are present. The tag-list and `&` tests pass already.

- [ ] **Step 3: Implement**

- `splitSubject(subject, { comma })`: when `comma` is false, use the separator class without `,`.
- `INVERTED_NAME = /^[^,()]+,\s*[^,()]+\([^()]*\)\s*$/`.
- In step 10, build `const catalogue = subjects.some((s) => typeof s === 'string' && splitSubdivisions(s).length > 1);` before `proposeSplit`. Inside `proposeSplit`, call `splitSubject(subject, { comma: !catalogue && !INVERTED_NAME.test(subject) })`.
- Replace the comment above `splitSubdivisions` that says "Last, First" forms do not occur in subjects. The new comment explains that catalogue headings use commas inside one heading (inverted names and qualifiers), so a comma counts as a separator only in a book with no `--` subjects and only when the subject is not shaped `X, Y (Qualifier)`. Update the step-10 comment that mentions the Bennet example to match.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command. Expected: PASS, all tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint   # repo root
git add app/server/utils/metadata-issues.ts app/server/utils/metadata-issues.test.ts app/server/services/epub-import-pipeline.test.ts
git commit -m "fix(metadata): stop proposing comma splits of catalogue subject headings"
```

### Task 2: Distinguishable `to` for subject splits

**Files:**
- Modify: `app/server/utils/metadata-issues.ts` (both `subjects-split` pushes in step 10)
- Test: `app/server/utils/metadata-issues.test.ts`

- [ ] **Step 1: Update the tests first.** In `proposes splitting a compound subject as one fix…`, expect `s.to` to be `'Sci-Fi | Fantasy'`. In `auto-splits a "--" subdivided subject…`, expect `to: 'England | Fiction'`. Add:

```ts
it('gives a comma split a "to" that differs from its "from"', () => {
  const s = find(detectMetadataIssues({ ...base, subjects: ['Sci-Fi, Fantasy'] }), 'subjects-split')!;
  expect(s.to).toBe('Sci-Fi | Fantasy');
  expect(s.to).not.toBe(s.from);
});
```

- [ ] **Step 2: Run and confirm failure.** Same command. Expected: these three tests FAIL with `'Sci-Fi, Fantasy'` / `'England, Fiction'` received.

- [ ] **Step 3: Implement.** In both pushes, replace `.join(', ')` with `.join(' | ')`.

- [ ] **Step 4: Run and confirm pass.** Same command. Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
git add app/server/utils/metadata-issues.ts app/server/utils/metadata-issues.test.ts
git commit -m "fix(metadata): join subject split targets with ' | ' so MCP shows a change"
```

Other tests that hard-code `to: 'A, B'` (`resolve-pending-fix.test.ts`, `epub-import-pipeline.test.ts:243`, client tests) use it as fixture input, not detection output, so they stay as they are.
