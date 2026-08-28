import { builder } from '../builder';

export type MessageSegmentShape = { text: string; subject: boolean };

/**
 * One prose or subject run of a `ValidationMessage.message`, as produced by
 * `splitSubjects` (`services/epub-validator.ts`) — this type does not
 * reimplement that split, only exposes its already-computed output.
 * `subject: true` marks a run that was a double-quoted span in the raw
 * message (quotes stripped); the client renders it monospaced. Everything
 * else is plain prose with `subject: false`.
 *
 * NEW API surface, not a restored field: GraphQL never exposed a `segments`
 * field before this task, on `ValidationMessage` or anywhere else. This is
 * now the only reader that rebuilds segments from the stored `message` text
 * — `ValidationStore` used to do the same on its own read path, which went
 * away with the REST library surface.
 *
 * `subject` is declared `Boolean!` even though `splitSubjects`'s own
 * `MessageSegment` type leaves `subject` UNSET (not `false`) on prose runs
 * — verified directly against `epub-validator.ts` (the loop's two
 * `segments.push({ text: ... })` calls carry no `subject` key at all) and
 * against that file's own tests (`epub-validator.test.ts`), which assert
 * bare `{ text }` objects — no `subject: false` — for unquoted messages.
 * `validation-message/model.ts`'s `segments` resolver normalizes that gap
 * (`subject: s.subject === true`) before constructing this shape, so every
 * run this type ever sees already carries an explicit boolean — the
 * non-null guarantee is made THERE, by the resolver, not by this type.
 */
export const model = builder.objectRef<MessageSegmentShape>('MessageSegment').implement({
  fields: (t) => ({
    text: t.exposeString('text'),
    subject: t.exposeBoolean('subject'),
  }),
});
