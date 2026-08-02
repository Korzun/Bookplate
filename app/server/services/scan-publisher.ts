import type { ScanJob } from './scan-events';

/**
 * The structural shape `ScanJobStore` needs from a pubsub to publish/
 * subscribe scan job updates — deliberately declared here, in `services/`,
 * rather than importing `graphql/pubsub.ts`'s concrete `ScanPubSub` type.
 * `ScanPubSub` (yoga's own `createPubSub`, keyed `'scan'` by userId)
 * satisfies this shape structurally — no adapter needed — so `index.ts` and
 * `graphql/test-util.ts` can construct the real one and inject it here
 * exactly as before.
 *
 * Review (task 9, I-1): the first version of this task had `ScanJobStore`
 * import `graphql/pubsub.ts` directly, making it the codebase's only
 * `services/` file depending on `graphql/` — every other boundary in this
 * codebase runs the arrow the other way. The task's brief named a file PATH
 * (`graphql/pubsub.ts`), not a dependency DIRECTION; this contract restores
 * the usual direction (graphql depends on services, never the reverse) with
 * zero behaviour change — `graphql/pubsub.ts` still lives exactly where the
 * plan named it, it just now depends on this type instead of the reverse.
 */
export type ScanPublisher = {
  publish(key: 'scan', userId: string, job: ScanJob): void;
  subscribe(key: 'scan', userId: string): AsyncIterable<ScanJob>;
};

/**
 * The default for every non-GraphQL `ScanJobStore` caller (`routes/ui.test.ts`,
 * `scan-job-store.test.ts`'s many bare `new ScanJobStore()` call sites): a
 * publisher nobody ever subscribes to on that path, so publishing into a sink
 * that does nothing is correct, not merely inert — a genuine no-op, rather
 * than the previous default's "a real, throwaway pubsub nobody happens to use".
 */
export const noopScanPublisher: ScanPublisher = {
  publish: () => {
    // No subscriber will ever exist for a store using this default.
  },
  subscribe: async function* (): AsyncGenerator<ScanJob> {
    // Intentionally empty: nothing is ever published to a store using this
    // default, so there is nothing to yield — an immediately-exhausted
    // iterator rather than one that hangs forever.
  },
};
