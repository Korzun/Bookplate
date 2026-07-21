import * as crypto from 'crypto';

import jwt from 'jsonwebtoken';

import { signAccessToken, verifyAccessToken, ACCESS_TOKEN_TTL_SECONDS } from './jwt';

const secret = crypto.randomBytes(32);

describe('signAccessToken / verifyAccessToken', () => {
  it('round-trips user claims', () => {
    const token = signAccessToken(secret, {
      userId: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
    });
    expect(verifyAccessToken(secret, token)).toEqual({
      userId: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
    });
  });

  it('omits userId for the config admin', () => {
    const token = signAccessToken(secret, {
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });
    const user = verifyAccessToken(secret, token);
    expect(user).toEqual({ username: 'admin', isAdmin: true, mustChangePassword: false });
    expect(user).not.toHaveProperty('userId');
  });

  it('sets a 15-minute expiry', () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
    const token = signAccessToken(secret, {
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const payload = jwt.decode(token) as jwt.JwtPayload;
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAccessToken(crypto.randomBytes(32), {
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    expect(verifyAccessToken(secret, token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = jwt.sign(
      { username: 'alice', isAdmin: false, mustChangePassword: false },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: -10,
      }
    );
    expect(verifyAccessToken(secret, token)).toBeNull();
  });

  it('rejects garbage and tokens with the "none" algorithm', () => {
    expect(verifyAccessToken(secret, 'not.a.jwt')).toBeNull();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ username: 'evil', isAdmin: true, mustChangePassword: false })
    ).toString('base64url');
    expect(verifyAccessToken(secret, `${header}.${payload}.`)).toBeNull();
  });
});
