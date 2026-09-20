/**
 * The unauthenticated half of the email work: "I forgot my password".
 *
 * REST, not GraphQL, for two reasons that both point the same way — every field
 * in the GraphQL schema is gated on `authenticated`, and these routes sit beside
 * `/api/login` where the IP rate limiter already lives. They are also exempted
 * from both credential gates (`middleware/auth.ts`), because a caller who owes a
 * password change or an address may legitimately be resetting by email.
 *
 * `forgot` ALWAYS answers 204 with an empty body. Unknown address, unverified
 * address, malformed address and the config admin are indistinguishable, so the
 * endpoint cannot be used to test whether an address has an account here.
 */
import type { PrismaClient } from '@prisma/client';
import express, { Request, Response, Router } from 'express';

import { logger } from '../logger';
import { findUserByEmail } from '../services/email';
import { consumeEmailToken, invalidateEmailTokens, issueEmailToken } from '../services/email-token';
import { passwordResetMessage } from '../services/mail-template';
import { isMailConfigured, type Mailer } from '../services/mailer';
import { hashLoginPassword } from '../services/password';
import { revokeAllForUsername } from '../services/token';
import type { AppConfig } from '../types';
import { asyncHandler } from '../utils/async-handler';

const log = logger('Password');

/**
 * A NEW floor, introduced here and deliberately stricter than anything else in
 * this codebase: `userChangePassword` enforces only `z.string().min(1)` and the
 * client checks only non-empty-and-matching, so no password length rule exists
 * today. This route is the one password entry point a stranger can reach without
 * being signed in, and matching `min(1)` would let an email-driven reset set a
 * one-character password.
 *
 * The asymmetry is intentional: reset refuses something the authenticated change
 * path allows. Do NOT "fix" it by lowering this to 1.
 */
const MIN_PASSWORD_LENGTH = 8;

export function createPasswordRouter(deps: {
  prisma: PrismaClient;
  config: AppConfig;
  mailer: Mailer | null;
  rateLimit: express.RequestHandler;
}): Router {
  const router = Router();
  const { prisma, config, mailer, rateLimit } = deps;

  // Mail off ⇒ the whole flow does not exist. 404 rather than 503: there is no
  // resource here to be temporarily unavailable, and the client already hides the
  // affordance via `emailEnabled`.
  const requireMail = (_req: Request, res: Response, next: express.NextFunction): void => {
    if (!isMailConfigured(config) || mailer === null) {
      res.sendStatus(404);
      return;
    }
    next();
  };

  router.post(
    '/api/password/forgot',
    rateLimit,
    requireMail,
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = req.body as { email?: unknown };
      // Answer first, work second: the response is identical in every case, and
      // deciding it up front makes it impossible for a later branch to leak one.
      res.sendStatus(204);
      if (typeof email !== 'string') return;

      const account = await findUserByEmail(prisma, email);
      if (account === null || account.email === null) return;
      if (account.emailVerifiedAt === null) {
        log.warn('Password reset requested for an unverified address — not sending');
        return;
      }
      if (account.isConfigAdmin) {
        // The admin's password is `config.password`, read from the add-on
        // options. Nothing this endpoint could send would change it.
        log.warn('Password reset requested for the admin account — not sending');
        return;
      }

      const issued = await issueEmailToken(prisma, {
        userId: account.id,
        purpose: 'reset',
        email: account.email,
      });
      if (!issued.ok) {
        log.warn(`Password reset throttled for "${account.username}" (${issued.reason})`);
        return;
      }
      const result = await mailer!.send(
        passwordResetMessage({
          to: account.email,
          code: issued.code,
          libraryName: config.libraryName,
          publicUrl: config.publicUrl ?? null,
        })
      );
      if (!result.ok) {
        log.warn(`Password reset email failed for "${account.username}" (${result.reason})`);
      }
    })
  );

  router.post(
    '/api/password/reset',
    rateLimit,
    requireMail,
    asyncHandler(async (req: Request, res: Response) => {
      const { email, code, newPassword } = req.body as {
        email?: unknown;
        code?: unknown;
        newPassword?: unknown;
      };
      // One 400 for every failure — wrong code, unknown address, weak password,
      // expired token. The user's next action is the same in all of them, and
      // distinguishing them tells a guesser which half of the guess landed.
      const reject = (reason: string): void => {
        log.warn(`Password reset rejected — ${reason}`);
        res.status(400).json({ error: 'That reset code is not valid or has expired.' });
      };

      if (
        typeof email !== 'string' ||
        typeof code !== 'string' ||
        typeof newPassword !== 'string'
      ) {
        reject('malformed body');
        return;
      }
      // Checked before any token lookup so a too-short password can never burn a
      // valid, otherwise-usable code.
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        reject('new password too short');
        return;
      }
      const account = await findUserByEmail(prisma, email);
      if (account === null || account.isConfigAdmin) {
        reject('no eligible account for that address');
        return;
      }
      const consumed = await consumeEmailToken(prisma, {
        userId: account.id,
        purpose: 'reset',
        code,
      });
      if (consumed === null) {
        reject('unknown, used or expired code');
        return;
      }
      // The token records the address it was sent to, so a code minted before an
      // address change cannot be spent after it.
      if (account.email === null || consumed.email !== account.email) {
        reject('code was issued for a different address');
        return;
      }

      // Ordered revoke -> update -> invalidate so no partial failure below can
      // leave a NEW password live alongside STILL-VALID refresh tokens — the one
      // inversion this order exists to rule out. Do not reorder these.
      //
      // The code above has already been consumed (`consumeEmailToken` deletes
      // the row unconditionally, before any of this runs), so in every failure
      // case below it is gone, not merely unspent: recovery is always a fresh
      // `/forgot` request, never a resubmit of the same code.
      //
      //   - failed revoke: nothing below it ran — the account is exactly as it
      //     was before this request (old password, old tokens).
      //   - failed update: every refresh token is already revoked (a forced
      //     logout) but the old password is still the live one — never a new
      //     password with old tokens still valid.
      //   - failed invalidate: harmless — everything that matters already
      //     succeeded, and `invalidateEmailTokens` here is belt-and-braces only,
      //     since `consumeEmailToken` already removed the row.
      //
      // The order NOT to use is update-then-revoke: if the revoke then threw,
      // the account would be left strictly worse than before the request — new
      // password live, every pre-existing refresh token still valid — with a 500
      // telling the caller it failed.
      await revokeAllForUsername(prisma, account.username);
      // Same side effect `userChangePassword` has, for the same reason: a stolen
      // or stale refresh token must not outlive a password change.
      await prisma.user.update({
        where: { id: account.id },
        data: {
          passwordHash: await hashLoginPassword(newPassword),
          // A reset satisfies the forced-change requirement: the user just chose
          // this password themselves.
          mustChangePassword: false,
        },
      });
      await invalidateEmailTokens(prisma, account.id, 'reset');
      log.info(`Password reset completed for "${account.username}"`);
      res.sendStatus(204);
    })
  );

  return router;
}
