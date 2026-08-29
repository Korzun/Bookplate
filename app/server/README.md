# app/server

Notes on conventions that are easy to get wrong, written so the next person
doesn't re-derive them. See also `services/README.md` (why that directory is
flat).

## Comments: separate what was MEASURED from what was CONCLUDED

This codebase is roughly 40% comment by line, deliberately. That is not the
problem this note is about.

The problem is that comments carry no expiry date, so a conclusion that was
true when written keeps reading as settled fact long after the thing it
depended on has changed. Two kinds of statement age very differently:

**Measured facts** — "21 queries became 2", "`wrapResolve` takes its fast path
only on a `getLoaderMapping` hit (`lib/index.js`)". These stay true, or fail
loudly when a dependency changes. Cite the number and where it came from.

**Architectural conclusions** — "`t.relationCount` cannot express this",
"deliberately two queries", "this is the only way". These are true relative to
a version of the code, a version of a library, and a set of alternatives
someone considered once. They decay silently, and because they are usually the
best-written paragraphs in the file, they are the most likely to be believed.

**So: a conclusion comment should say how it was established, and leave a
handle to re-check it.** "Measured at N queries for a page of M" or "verified
by reading X" or — honestly — "reasoned, not measured". A future reader can
then tell a cheap re-test from a settled question.

### Three worked examples, all from one migration pass

Each of these was accurate when written and actively misleading later:

- **`Library.progress`: "TWO QUERIES, DELIBERATELY."** A carefully argued
  paragraph explaining why the resolver re-read its own rows. The reasoning was
  sound; the premise (a DTO with two REST consumers) had since become false,
  both consumers having been deleted. It made a fixable defect read as a
  considered decision. Removed once someone questioned it — a twenty-minute
  fix; `git log -S "TWO QUERIES, DELIBERATELY"` finds the removal.

  (Deliberately named by its content rather than by a commit SHA: this repo
  rebase-merges, so a branch-local SHA cited in code does not survive landing.
  Cite something greppable, or a commit that is already on `main`.)

- **`Book.deviceEditionCount`: "`t.relationCount` cannot express it."** True —
  there was no relation. But the framing implied "add the relation and this
  gets better", which is the opposite of what happened: measured, the
  conversion was neutral-to-worse. The comment now carries the numbers.
- **"Several loaders duplicate what the Prisma plugin already does."** A
  reasonable-sounding premise that drove a whole audit. False: every attempt to
  replace a loader with `t.relation`/`t.relationCount` measured worse, twice by
  4.5x.

### The one that would have saved all three

If a comment states that some plugin mechanism can or cannot be used on a field
reached from `Library.entries`, read `graphql/loaders/pair-loader.ts` first.
That connection is hand-built — its node type is a union over an interleaved
two-table keyset, so `t.prismaConnection`, which binds to one model, cannot
express it — and `@pothos/plugin-prisma` never plans a query it did not build,
so no `select`-carrying field on its rows can merge into one. That single fact
explains every request-scoped loader left in this server, and it is the thing
three separate comments each described a corner of.

### A fourth example, of the opposite failure

The same paragraph used to name `Library.progress` alongside `Library.entries`,
and to call both "permanently hand-built". Every word of the mechanism was
right; "permanently" was the word doing the damage. `Library.progress` was
hand-built to keep `last`/`before` out of its SDL — a DECISION (`e7f99557`),
not a constraint — and the comment stated the consequence so well that the
decision behind it stopped being visible as one. It cost two loaders. Reversing
the decision took the field to `t.prismaConnection` and a page of 8 from 3
queries to 1.

The lesson is not "the comment was wrong". It is that a conclusion resting on a
decision should name the decision, so the next reader can weigh it, rather than
reading as a law of the library.
