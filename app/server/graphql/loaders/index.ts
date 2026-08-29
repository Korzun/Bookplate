/**
 * Re-export barrel for the request-scoped loaders.
 *
 * Purely re-exports — no side effects — unlike the entity `index.ts` files
 * under `schema/`, which side-effect-import their mutations and must therefore
 * never be imported from a model file. Nothing here participates in a require
 * cycle, so the three consumers (`context.ts`, `test-util.ts`,
 * `routes/ui.test.ts`) can each take one import line instead of seven.
 *
 * `pair-loader.ts` — the shared implementation, and the explanation of why
 * these loaders exist rather than `t.relation`/`t.relationCount` — is
 * deliberately NOT re-exported: it is an implementation detail of this
 * directory, and a consumer reaching for `createPairLoader` directly is
 * building a loader, which belongs in here beside its siblings.
 */
export { createBookByDocumentLoader, type BookByDocumentLoader } from './book-by-document';
export {
  createDeviceEditionCountLoader,
  type DeviceEditionCountLoader,
} from './device-edition-count';
export { createLineageLoader, type LineageLoader } from './lineage';
export { createOwnerLoader, type OwnerLoader } from './owner';
export { createPendingFixLoader, type PendingFixLoader } from './pending-fix';
export { createProgressLoader, type ProgressLoader } from './progress';
export { createSeriesProgressLoader, type SeriesProgressLoader } from './series-progress';
export {
  createValidationCountsLoader,
  type SeverityCount,
  type ValidationCountsLoader,
} from './validation-counts';
