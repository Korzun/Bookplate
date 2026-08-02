import * as fs from 'fs';
import * as path from 'path';

import { encodeGlobalID } from '@pothos/plugin-relay';
import AdmZip from 'adm-zip';

import { createHarness, type Harness } from '../../../test-util';

vi.mock('../../../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

function makeMinimalEpub(title: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  );
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata>
  <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx"/>
</package>`)
  );
  return zip.toBuffer();
}

const MUTATION = `
  mutation Scan($input: LibraryScanInput!) {
    libraryScan(input: $input) {
      __typename
      ... on LibraryScanPayload {
        scanStatus {
          id
          state
          phase
          total
          processed
          currentFile
          startedAt
          error
          result { importedFilenames removed imported { id title } }
        }
        library { user { username } }
      }
      ... on ScanAlreadyRunningError {
        message
        scanStatus { id state }
      }
    }
  }
`;

// Same "poll a short interval" shape as `routes/ui.test.ts`'s `waitForScan` —
// the mutation deliberately does not await the scan (fire-and-forget, mirrors
// REST's 202), so a test that cares about the eventual outcome has to poll
// the store the same way REST's own client (and REST's own test suite) does.
async function waitForScanSettled(h: Harness, userId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const job = h.stores.scanJob.get(userId);
    if (job && job.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('scan did not settle in time');
}

describe('Mutation.libraryScan', () => {
  it('starts a scan for the viewer’s own library and returns a running ScanStatus', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.libraryScan as {
      __typename: string;
      scanStatus: {
        id: string;
        state: string;
        phase: string;
        total: number;
        processed: number;
        currentFile: string | null;
        startedAt: string;
        error: string | null;
        result: unknown;
      };
      library: { user: { username: string } };
    };

    expect(data.__typename).toBe('LibraryScanPayload');
    expect(data.scanStatus.state).toBe('RUNNING');
    expect(data.scanStatus.phase).toBe('IMPORTING');
    expect(data.scanStatus.total).toBe(0);
    expect(data.scanStatus.processed).toBe(0);
    expect(data.scanStatus.currentFile).toBeNull();
    expect(data.scanStatus.result).toBeNull();
    expect(data.scanStatus.error).toBeNull();
    expect(typeof data.scanStatus.id).toBe('string');
    expect(data.scanStatus.id).not.toHaveLength(0);
    expect(new Date(data.scanStatus.startedAt).toString()).not.toBe('Invalid Date');
    expect(data.library.user.username).toBe('alice');

    await waitForScanSettled(harness, harness.aliceOwner.userId);
  });

  it('refuses one user scanning another user’s library, and starts no job for the victim', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.bobViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    // Victim-state assertion first (no job started for alice), same ordering
    // rationale `bookDelete.test.ts` documents: a probe that merely weakens
    // the auth guard must not slip past this expectation.
    expect(harness.stores.scanJob.get(harness.aliceOwner.userId)).toBeUndefined();
    expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    expect(result.data?.libraryScan ?? null).toBeNull();
  });

  it('lets an admin start a scan for a named user’s library', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data?.libraryScan as {
      __typename: string;
      library: { user: { username: string } };
    };
    expect(data.__typename).toBe('LibraryScanPayload');
    expect(data.library.user.username).toBe('alice');
    expect(harness.stores.scanJob.get(harness.aliceOwner.userId)).toBeDefined();

    await waitForScanSettled(harness, harness.aliceOwner.userId);
  });

  it('resolves to null for an admin targeting a user id that does not exist, mirroring REST’s 404', async () => {
    const unknownUserId = encodeGlobalID('User', 'no-such-user-id');
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { userId: unknownUserId } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.libraryScan).toBeNull();
  });

  it('returns ScanAlreadyRunningError with the in-flight job when a scan is already running', async () => {
    const running = harness.stores.scanJob.start(harness.aliceOwner.userId);

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.libraryScan).toEqual({
      __typename: 'ScanAlreadyRunningError',
      message: 'A scan is already running for this library.',
      scanStatus: { id: running.jobId, state: 'RUNNING' },
    });
    // No second job was started — the tracked job is still the original one.
    expect(harness.stores.scanJob.get(harness.aliceOwner.userId)?.jobId).toBe(running.jobId);
  });

  it('runs the scan to completion in the background: imports a book, validates it, and reconciles thumbnails', async () => {
    const reconcileSpy = vi.spyOn(harness.stores.thumbnail, 'reconcile');
    const booksDir = path.join(harness.config.booksDir, 'alice');
    fs.mkdirSync(booksDir, { recursive: true });
    fs.writeFileSync(path.join(booksDir, 'found.epub'), makeMinimalEpub('Found By Scan'));

    const result = await harness.execute(MUTATION, {
      viewer: harness.aliceViewer,
      variables: { input: { userId: harness.aliceGlobalId } },
    });
    expect(result.errors).toBeUndefined();

    await waitForScanSettled(harness, harness.aliceOwner.userId);
    const job = harness.stores.scanJob.get(harness.aliceOwner.userId);
    expect(job?.status).toBe('completed');
    expect(job?.result?.imported).toEqual(['found.epub']);
    expect(job?.importedBookIds).toHaveLength(1);

    const [bookId] = job!.importedBookIds;
    expect(
      await harness.stores.validation.getValidation(harness.aliceOwner, bookId)
    ).not.toBeNull();
    expect(reconcileSpy).toHaveBeenCalled();
  });
});
