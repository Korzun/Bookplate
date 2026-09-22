import * as path from 'path';

import { CLIENT_DIST_DIR, CLIENT_INDEX_HTML } from './client-dist';

// The layout walk itself is covered in `server-root.test.ts`; what matters
// here is that this module points at the client workspace's build output and
// not, as it once did, at a `<repo>/client/dist` outside `app/` entirely.
describe('CLIENT_DIST_DIR', () => {
  it('points inside app/, at the client workspace build output', () => {
    expect(CLIENT_DIST_DIR).toBe(path.resolve(process.cwd(), '../client/dist'));
  });

  it('CLIENT_INDEX_HTML is the shell inside it', () => {
    expect(CLIENT_INDEX_HTML).toBe(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
});
