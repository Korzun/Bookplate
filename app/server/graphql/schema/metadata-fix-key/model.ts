import { builder } from '../builder';

/**
 * Addresses one `MetadataFix` inside a `PendingFix` row's `proposals`.
 *
 * `MetadataFix` has no id — it is a detected issue, regenerated per import,
 * not a stored entity. The client already identifies fixes by this exact
 * triple (`fixKey`, `provider/upload/`), which is field+kind+**from** rather
 * than field+kind because several `subjects-split` fixes on one book share a
 * field and a kind and differ only in which compound subject they split.
 *
 * Positional addressing was rejected: an index that goes stale between the
 * read and the mutation silently resolves a DIFFERENT fix, which is worse
 * than not matching at all.
 */
export const model = builder.inputType('MetadataFixKeyInput', {
  description:
    "Addresses one `MetadataFix` inside a pending fix's proposals. `MetadataFix` has no " +
    'server id — it is a detected issue, regenerated per import, not a stored entity — so ' +
    'it is addressed by this field+kind+from triple instead: several `subjects-split` ' +
    'fixes on one book can share a field and kind, differing only in which compound ' +
    'subject they split, so `from` is what disambiguates them.',
  fields: (t) => ({
    field: t.string({
      required: true,
      description: 'The `MetadataFix.field` of the proposal this key addresses.',
    }),
    kind: t.string({
      required: true,
      description: 'The `MetadataFix.kind` of the proposal this key addresses.',
    }),
    from: t.string({
      required: true,
      description:
        'The `MetadataFix.from` of the proposal this key addresses. Included because ' +
        'several `subjects-split` fixes on one book can share both `field` and `kind`, ' +
        'differing only in which compound subject they split — `field`+`kind` alone ' +
        'would be ambiguous between them.',
    }),
  }),
});
