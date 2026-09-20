import jwt from 'jsonwebtoken';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Identity carried by a verified access token (attached to req.user). */
export type AuthUser = {
  /** Surrogate user ID. Absent for the config-based admin, whose token deliberately carries no sub. */
  userId?: string;
  username: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  /**
   * An address is required but this account has none, AND mail is configured on
   * this install. Gates the API and the client exactly as `mustChangePassword`
   * does. Always false when mail is unconfigured — an install that cannot send
   * must not demand an address it can never verify.
   */
  mustSetEmail: boolean;
};

export function signAccessToken(secret: Buffer, user: AuthUser): string {
  return jwt.sign(
    {
      username: user.username,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      mustSetEmail: user.mustSetEmail,
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      ...(user.userId !== undefined ? { subject: user.userId } : {}),
    }
  );
}

export function verifyAccessToken(secret: Buffer, token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (typeof payload.username !== 'string') return null;
    return {
      ...(typeof payload.sub === 'string' ? { userId: payload.sub } : {}),
      username: payload.username,
      isAdmin: payload.isAdmin === true,
      mustChangePassword: payload.mustChangePassword === true,
      // `=== true` rather than a typeof check in the contract guard above: a
      // token minted before this claim existed is still in browsers' storage for
      // up to ACCESS_TOKEN_TTL_SECONDS after an upgrade, and rejecting it would
      // log every signed-in user out for no gain — the server gates on database
      // state, not on the claim.
      mustSetEmail: payload.mustSetEmail === true,
    };
  } catch {
    return null;
  }
}
