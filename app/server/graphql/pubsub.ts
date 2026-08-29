import { createPubSub, type PubSub } from 'graphql-yoga';

import type { ScanJob } from '../services/scan-events';
// Type-only import, used solely for the compile-time `satisfies` proof below
// — this file still depends on `services/`, never the reverse (task 9
// review, I-1: `services/scan-job-store.ts` depends on the structural
// `ScanPublisher` contract, not on this file).
import type { ScanPublisher } from '../services/scan-publisher';

/**
 * The single pubsub channel this schema uses (spec §"Scan progress":
 * "a yoga `createPubSub()` publishing on a per-user topic"). Yoga's own
 * `createPubSub` builds the actual event-target topic string by joining the
 * routing key and the id argument with a colon
 * (`@graphql-yoga/subscription`'s `create-pub-sub.js`:
 * `` `${routingKey}:${args[0]}` ``) — so `pubsub.publish('scan', userId, job)`
 * and `pubsub.subscribe('scan', userId)` both target the literal topic the
 * spec and this task's brief name, `scan:${userId}`, without this module
 * having to build that string itself.
 *
 * `ScanJobStore` (`services/scan-job-store.ts`) is the only publisher —
 * one instance, constructor-injected there, same "single shared instance"
 * rule `ReplaceStaging` follows (`context.ts`'s `Context.replaceStaging` doc
 * comment) — and the only subscriber is `Subscription.scanProgress`
 * (`schema/library/subscription/scan-progress.ts`), reached only through
 * `ScanJobStore.subscribe`. Nothing else in the schema touches this module
 * directly.
 *
 * `ScanJobStore` itself never imports this file — it depends only on the
 * structural `ScanPublisher` contract (`services/scan-publisher.ts`), which
 * this module's return value satisfies without any adapter. `index.ts`/
 * `graphql/test-util.ts` are the two places that import `createScanPubSub`
 * and hand the result to `new ScanJobStore(...)`.
 */
type ScanPubSubEvents = {
  scan: [userId: string, job: ScanJob];
};

export type ScanPubSub = PubSub<ScanPubSubEvents>;

/**
 * The `satisfies` here is a compile-time proof, not a cast: `ScanPubSub`
 * (yoga's `PubSub<ScanPubSubEvents>`) already structurally matches
 * `ScanPublisher`'s shape on its own — `publish('scan', userId, job)`/
 * `subscribe('scan', userId)` — so this would fail to typecheck if the two
 * shapes ever drifted apart, with no runtime adapter required either way.
 */
export const createScanPubSub = (): ScanPubSub =>
  createPubSub<ScanPubSubEvents>() satisfies ScanPublisher;
