// `useDeleteProgress`/`useSetMyProgress` (from `./hook/use-progress-mutations`,
// re-exported below): the LAST non-list resident of this directory —
// Task 5b moves this file WHOLE to `src/lib/use-progress-mutations.ts`
// (updating its three importers) before deleting `provider/library/`, per
// the rehoming note at the top of that file itself (review round 1,
// Item 2). Do not inline it into its call sites while moving it — its
// `update` callbacks are not boilerplate.
export { useDeleteProgress, useSeriesDetail, useSetMyProgress } from './hook';
export type { UseDeleteProgress, UseSetMyProgress } from './hook/use-progress-mutations';
export type { SeriesDetail, UseSeriesDetail } from './hook/use-series-detail';
