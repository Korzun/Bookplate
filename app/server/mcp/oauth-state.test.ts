import * as crypto from 'crypto';

import { createAuthorizationCodes, type AuthorizationGrantRequest } from './authorization-codes';
import { signConsentRequest, verifyConsentRequest, type ConsentRequest } from './consent-request';
import { signTransferTicket } from './transfer-ticket';

const secret = crypto.randomBytes(32);

const grant: AuthorizationGrantRequest = {
  clientId: 'c1',
  userId: 'u1',
  redirectUri: 'http://localhost:7777/callback',
  redirectUriExplicit: true,
  codeChallenge: 'challenge',
  resource: 'http://nas.local:3000/mcp',
};

describe('authorization codes', () => {
  it('can be peeked at any number of times but redeemed once', () => {
    const codes = createAuthorizationCodes();
    const code = codes.issue(grant);
    expect(codes.peek(code)).toEqual(grant);
    expect(codes.peek(code)).toEqual(grant);
    expect(codes.consume(code)).toEqual(grant);
    expect(codes.consume(code)).toBeNull();
    expect(codes.peek(code)).toBeNull();
  });

  it('expire', () => {
    let now = 0;
    const codes = createAuthorizationCodes({ ttlMs: 100, now: () => now });
    const code = codes.issue(grant);
    now = 100;
    expect(codes.peek(code)).toBeNull();
    expect(codes.consume(code)).toBeNull();
  });

  it('know nothing of a code they did not issue', () => {
    expect(createAuthorizationCodes().consume('made-up')).toBeNull();
  });
});

describe('consent requests', () => {
  const request: ConsentRequest = {
    clientId: 'c1',
    redirectUri: 'http://localhost:7777/callback',
    redirectUriExplicit: false,
    codeChallenge: 'challenge',
    state: null,
    resource: 'http://nas.local:3000/mcp',
  };

  it('round-trip, with or without state', () => {
    expect(verifyConsentRequest(secret, signConsentRequest(secret, request))).toEqual(request);
    const withState = { ...request, state: 'xyz' };
    expect(verifyConsentRequest(secret, signConsentRequest(secret, withState))).toEqual(withState);
  });

  it('refuse a tampered, foreign or differently-purposed token', () => {
    const signed = signConsentRequest(secret, request);
    expect(verifyConsentRequest(secret, `${signed}x`)).toBeNull();
    expect(verifyConsentRequest(crypto.randomBytes(32), signed)).toBeNull();
    const ticket = signTransferTicket(secret, {
      type: 'download',
      userId: 'u1',
      grantId: 'g1',
      bookId: 'b1',
    });
    expect(verifyConsentRequest(secret, ticket)).toBeNull();
  });
});
