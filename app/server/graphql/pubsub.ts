import { createPubSub, type PubSub } from 'graphql-yoga';

import type { ScanJob } from '../services/scan-events';

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
 * rule `TokenStore`/`ReplaceStaging` follow (`context.ts`'s `Stores` doc
 * comments) — and the only subscriber is `Subscription.scanProgress`
 * (`schema/library/subscription/scan-progress.ts`), reached only through
 * `ScanJobStore.subscribe`. Nothing else in the schema touches this module
 * directly.
 */
type ScanPubSubEvents = {
  scan: [userId: string, job: ScanJob];
};

export type ScanPubSub = PubSub<ScanPubSubEvents>;

export const createScanPubSub = (): ScanPubSub => createPubSub<ScanPubSubEvents>();
