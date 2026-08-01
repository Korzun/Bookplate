import type { AppConfig } from '../../../types';
import { builder } from '../builder';

/**
 * Exactly the two values `GET /api/config` returns, and nothing else.
 *
 * Deliberately a `Pick` rather than `AppConfig` itself: `AppConfig` also
 * carries `password`, `booksDir` and `dataDir`. Pinning the ref to a narrowed
 * shape means a future `t.exposeString('password')` here does not typecheck,
 * rather than relying on nobody adding one.
 */
export type ConfigView = Pick<AppConfig, 'libraryName' | 'maxConcurrentUploads'>;

export const model = builder.objectRef<ConfigView>('Config').implement({
  fields: (t) => ({
    libraryName: t.exposeString('libraryName'),
    maxConcurrentUploads: t.exposeInt('maxConcurrentUploads'),
  }),
});
