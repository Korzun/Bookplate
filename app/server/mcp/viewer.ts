/**
 * Turns the `AuthInfo` the bearer middleware attached to an MCP request into
 * the `Viewer` the GraphQL schema authorizes against.
 *
 * The two gate flags are read from the database on every request rather than
 * baked into the token: `authenticated` (the scope every schema field
 * carries) refuses a viewer who owes a password change or an email address,
 * and an MCP token has no refresh-claims step the way the SPA's JWT does. An
 * assistant therefore sees the gate the moment it closes, and the tools
 * answer with `SETUP_REQUIRED_MESSAGE` instead of a bare "Not authorized".
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { PrismaClient } from '@prisma/client';

import type { Viewer } from '../graphql/context';
import { computeMustSetEmail } from '../routes/ui';
import { getMustChangePassword } from '../services/password';
import type { AppConfig } from '../types';

export const SETUP_REQUIRED_MESSAGE =
  'Finish setting up your Bookplate account in the web app first.';

export type ViewerDeps = { prisma: PrismaClient; config: AppConfig };

/** Null when the token carries no user (never issued by us) or the user row is gone. */
export async function viewerFromAuthInfo(deps: ViewerDeps, auth: AuthInfo): Promise<Viewer | null> {
  const userId = auth.extra?.userId;
  if (typeof userId !== 'string') return null;
  const row = await deps.prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });
  if (row === null) return null;
  return {
    userId,
    username: row.username,
    isAdmin: false,
    mustChangePassword: await getMustChangePassword(deps.prisma, row.username),
    mustSetEmail: await computeMustSetEmail(deps.prisma, deps.config, { username: row.username }),
  };
}

/** Mirrors the `authenticated` scope in `graphql/schema/builder.ts`. */
export const isSetupComplete = (viewer: Viewer): boolean =>
  !viewer.mustChangePassword && !viewer.mustSetEmail;
