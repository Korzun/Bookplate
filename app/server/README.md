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
  considered decision. Removed in `fd2d9770`, and it was a twenty-minute fix
  once someone questioned it.
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
reached from `Library.entries` or `Library.progress`, read
`graphql/loaders/pair-loader.ts` first. Those two connections are permanently
hand-built (their SDL omits `last`/`before`, and `entries` is a union over an
interleaved two-table keyset besides), so `@pothos/plugin-prisma` never plans
their queries and no `select`-carrying field on their rows can merge into one.
That single fact explains every request-scoped loader in this server, and it is
the thing three separate comments each described a corner of.
