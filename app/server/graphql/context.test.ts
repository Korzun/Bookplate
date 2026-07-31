import type { PrismaClient } from '@prisma/client';

import { signAccessToken } from '../services/jwt';
import type { AppConfig } from '../types';
import { createContext, viewerFromHeader, type Stores } from './context';

const secret = Buffer.from('a'.repeat(64), 'hex');

describe('viewerFromHeader', () => {
  it('returns null when there is no header', () => {
    expect(viewerFromHeader(secret, undefined)).toBeNull();
  });

  it('returns null when the header is not a Bearer token', () => {
    expect(viewerFromHeader(secret, 'Basic YWxpY2U6cGFzcw==')).toBeNull();
  });

  it('returns null when the token does not verify', () => {
    expect(viewerFromHeader(secret, 'Bearer not-a-real-token')).toBeNull();
  });

  it('returns null when the token was signed with a different secret', () => {
    const otherSecret = Buffer.from('b'.repeat(64), 'hex');
    const token = signAccessToken(otherSecret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)).toBeNull();
  });

  it('maps a user token to a viewer carrying its userId', () => {
    const token = signAccessToken(secret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)).toEqual({
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
  });

  it('maps the config admin token, which has no subject claim, to a null userId', () => {
    const token = signAccessToken(secret, {
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)).toEqual({
      userId: null,
      username: 'admin',
      isAdmin: true,
      mustChangePassword: false,
    });
  });

  it('preserves the mustChangePassword claim', () => {
    const token = signAccessToken(secret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: true,
    });
    expect(viewerFromHeader(secret, `Bearer ${token}`)?.mustChangePassword).toBe(true);
  });
});

describe('createContext', () => {
  const prisma = {} as PrismaClient;
  const stores = {} as Stores;
  const config = {} as AppConfig;

  it('derives the viewer from the request Authorization header', () => {
    const token = signAccessToken(secret, {
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
    });
    const context = createContext({ prisma, stores, config, jwtSecret: secret })({
      request: new Request('http://localhost/graphql', {
        headers: { authorization: `Bearer ${token}` },
      }),
    });

    expect(context.viewer?.username).toBe('alice');
    expect(context.prisma).toBe(prisma);
    expect(context.stores).toBe(stores);
    expect(context.config).toBe(config);
  });

  it('yields a null viewer when the request carries no Authorization header', () => {
    const context = createContext({ prisma, stores, config, jwtSecret: secret })({
      request: new Request('http://localhost/graphql'),
    });

    expect(context.viewer).toBeNull();
  });
});
