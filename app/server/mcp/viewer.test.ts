import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { createContextForViewer } from '../graphql/context';
import { createHarness, MAIL_CONFIG, type Harness } from '../graphql/test-util';
import { resetPassword } from '../services/password';
import { deleteUser } from '../services/user';
import { isSetupComplete, SETUP_REQUIRED_MESSAGE, viewerFromAuthInfo } from './viewer';

vi.mock('../logger');

let harness: Harness;

afterEach(async () => {
  await harness.cleanup();
});

const authFor = (userId: string | undefined, username = 'alice'): AuthInfo => ({
  token: 't',
  clientId: 'c1',
  scopes: ['library:read'],
  expiresAt: Math.floor(Date.now() / 1000) + 60,
  extra: userId === undefined ? { username } : { userId, username, grantId: 'g1' },
});

describe('viewerFromAuthInfo', () => {
  it('builds a non-admin viewer with both gate flags false for a set-up account', async () => {
    harness = await createHarness();
    const viewer = await viewerFromAuthInfo(
      { prisma: harness.prisma, config: harness.config },
      authFor(harness.aliceOwner.userId)
    );
    expect(viewer).toEqual({
      userId: harness.aliceOwner.userId,
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      mustSetEmail: false,
    });
    expect(isSetupComplete(viewer!)).toBe(true);
  });

  it('reflects a forced password change', async () => {
    harness = await createHarness();
    await resetPassword(harness.prisma, 'alice');
    const viewer = await viewerFromAuthInfo(
      { prisma: harness.prisma, config: harness.config },
      authFor(harness.aliceOwner.userId)
    );
    expect(viewer?.mustChangePassword).toBe(true);
    expect(isSetupComplete(viewer!)).toBe(false);
  });

  it('reflects a missing address when mail is configured', async () => {
    harness = await createHarness({ mail: MAIL_CONFIG });
    const viewer = await viewerFromAuthInfo(
      { prisma: harness.prisma, config: harness.config },
      authFor(harness.aliceOwner.userId)
    );
    expect(viewer?.mustSetEmail).toBe(true);
    expect(isSetupComplete(viewer!)).toBe(false);
  });

  it('is null for a token without a user id or whose user is gone', async () => {
    harness = await createHarness();
    expect(
      await viewerFromAuthInfo({ prisma: harness.prisma, config: harness.config }, authFor(undefined))
    ).toBeNull();
    await deleteUser(harness.prisma, harness.editionsRoot, 'alice');
    expect(
      await viewerFromAuthInfo(
        { prisma: harness.prisma, config: harness.config },
        authFor(harness.aliceOwner.userId)
      )
    ).toBeNull();
  });

  it('names the setup message the tools will return', () => {
    expect(SETUP_REQUIRED_MESSAGE).toBe(
      'Finish setting up your Bookplate account in the web app first.'
    );
  });
});

describe('createContextForViewer', () => {
  it('builds the same Context shape the harness does, for a given viewer', async () => {
    harness = await createHarness();
    const context = createContextForViewer(harness.contextDeps, harness.aliceViewer);
    expect(context.viewer).toEqual(harness.aliceViewer);
    expect(Object.keys(context).sort()).toEqual(
      Object.keys(harness.contextFor(harness.aliceViewer)).sort()
    );
    expect(context.mcpUrl).toBe('https://books.example/mcp');
  });
});
