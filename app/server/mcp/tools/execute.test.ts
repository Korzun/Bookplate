import { createHarness, type Harness } from '../../graphql/test-util';
import type { ToolDeps } from './deps';
import { executeDocument, guarded, INTERNAL_ERROR_MESSAGE, ToolError } from './execute';

vi.mock('../../logger');

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

const depsFor = (): ToolDeps => ({
  context: harness.contextFor(harness.aliceViewer),
  viewer: { ...harness.aliceViewer, userId: harness.aliceOwner.userId },
  scopes: ['library:read', 'library:write'],
  prisma: harness.prisma,
  config: harness.config,
  replaceStaging: harness.replaceStaging,
  thumbnails: harness.thumbnails,
  editionsRoot: harness.editionsRoot,
  setupComplete: true,
});

describe('executeDocument', () => {
  it('passes the schema’s own errors through (auth, validation)', async () => {
    const anonymous = harness.contextFor(null);
    await expect(executeDocument(anonymous, '{ viewer { username } }')).rejects.toThrow(
      'Not authenticated'
    );
    await expect(
      executeDocument(harness.contextFor(harness.aliceViewer), '{ viewer { noSuchField } }')
    ).rejects.toThrow(/noSuchField/);
  });

  it('masks an unexpected resolver failure instead of forwarding its message', async () => {
    const context = harness.contextFor(harness.aliceViewer);
    // A Prisma stand-in on which every call, however reached, blows up with
    // the kind of message a real driver failure carries.
    const handler: ProxyHandler<() => void> = {
      get: (_target, prop) => (prop === 'then' ? undefined : thrower),
      apply: () => {
        throw new Error('SQLITE_BUSY at /data/db.sqlite');
      },
    };
    const thrower: () => void = new Proxy(() => {}, handler);
    const broken = thrower as unknown as typeof harness.prisma;
    const promise = executeDocument(
      { ...context, prisma: broken as typeof harness.prisma },
      '{ viewer { library { subjects } } }'
    );
    await expect(promise).rejects.toBeInstanceOf(ToolError);
    await expect(promise).rejects.toThrow(INTERNAL_ERROR_MESSAGE);
    await expect(promise).rejects.not.toThrow(/SQLITE_BUSY|db\.sqlite/);
  });
});

describe('guarded', () => {
  it('renders a ToolError as the tool’s text and masks anything else', async () => {
    const deps = depsFor();
    const known = await guarded(deps, {}, async () => {
      throw new ToolError('No such thing');
    });
    expect(known).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'No such thing' }],
    });

    const unknown = await guarded(deps, {}, async () => {
      throw new Error('ENOENT /media/books/alice/secret.epub');
    });
    expect(unknown.isError).toBe(true);
    const text = (unknown.content[0] as { text: string }).text;
    expect(text).toBe(INTERNAL_ERROR_MESSAGE);
    expect(text).not.toContain('/media');
  });
});
