import { builder } from '../../builder';
import { model as scanStatus, type ScanStatusShape } from '../../scan-status/model';
import { model as library } from '../model';

/**
 * Spec §"Scan progress": `type Subscription { scanProgress(libraryId: ID!):
 * ScanStatus! }`. `libraryId` decodes to the same userId `Library`'s own
 * global id IS (`library/model.ts`: `id: { resolve: (owner) => owner.userId
 * }`), so `ownerOf` on the decoded id is exactly the mutations' `ownerOf:
 * args.input.userId.id` shape, not a new one — see `library/mutation/
 * scan.ts`'s identical use for the precedent this follows.
 *
 * `builder.subscriptionType({ authScopes: { authenticated: true } })`
 * (`builder.ts`) ANDs with this field's own `ownerOf`, same as every other
 * scoped field in this schema. The subscribe-time (not per-event) auth check
 * needs `scopeAuth.authorizeOnSubscribe: true`, also set in `builder.ts` —
 * see that flag's own doc comment for why: without it, `@pothos/plugin-
 * scope-auth` only gates the field's `resolve` step (run once per emitted
 * event), and a cross-tenant caller could still open a live subscription
 * against another user's topic, denied only after the fact, event by event,
 * rather than at connection time. `args.libraryId.id` arrives already decoded
 * (not the raw base64 global id string) inside `authScopes` — CORRECTED
 * attribution (task 9 review, M-3): this is NOT `builder.ts`'s "RelayPlugin
 * before ScopeAuthPlugin" plugin-order note (that note is about `resolve`-
 * time ordering between plugins' own wrappers). Verified in
 * `@pothos/core/lib/plugins/merge-plugins.js`: `fieldConfig.argMappers` (the
 * relay global-ID decoder) is applied OUTSIDE the entire plugin chain, before
 * any plugin's `wrapResolve`/`wrapSubscribe` ever runs — so decoding precedes
 * `authScopes` regardless of plugin order, for every field kind including
 * `subscribe`. `scan-progress.test.ts` proves the behaviour empirically (a
 * same-user subscription succeeds; a cross-tenant one is refused before any
 * event arrives) — that evidence stands; only the mechanism cited here was
 * wrong.
 */
builder.subscriptionField('scanProgress', (t) =>
  t.field({
    type: scanStatus,
    description:
      'Streams live progress for a running or just-finished library scan. ' +
      'A scan started through REST is visible here too (the shared ' +
      'ScanJobStore instance publishes from both transports), but only at ' +
      'start/terminal granularity — REST passes no onProgress callback, so ' +
      'per-file progress only ever exists for a scan started through ' +
      '`libraryScan`. `Library.scanStatus` is the reconnect/current-state ' +
      'read for a client joining mid-scan.',
    args: {
      libraryId: t.arg.globalID({ required: true, for: library }),
    },
    authScopes: (_root, args) => ({ ownerOf: args.libraryId.id }),
    /**
     * Owner is resolved exactly once, up front — every event this generator
     * ever yields for this subscription's lifetime shares the one `Owner`
     * the subscribe-time `ownerOf` check already authorized, rather than a
     * fresh `loadOwner` call per event. A `null` owner (the resolved id
     * names no real user row — the same "no such row" case `libraryScan`'s
     * `nullable: true` return covers) yields nothing at all: `ScanStatus!`
     * is non-null, so there is no honest empty value to produce, and an
     * immediately-ending, event-free subscription is the closest analogue
     * to that mutation's `null` payload this field's shape allows.
     */
    subscribe: async function* (_root, args, context) {
      const owner = await context.loadOwner(args.libraryId.id);
      if (owner === null) return;
      for await (const job of context.stores.scanJob.subscribe(owner.userId)) {
        yield { owner, job } satisfies ScanStatusShape;
      }
    },
    resolve: (payload: ScanStatusShape): ScanStatusShape => payload,
  })
);
