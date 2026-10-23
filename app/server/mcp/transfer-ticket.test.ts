import * as crypto from 'crypto';

import jwt from 'jsonwebtoken';

import { signAccessToken, verifyAccessToken } from '../services/jwt';
import { signTransferTicket, verifyTransferTicket } from './transfer-ticket';

const secret = crypto.randomBytes(32);

const upload = {
  type: 'upload',
  userId: 'u1',
  grantId: 'g1',
  kind: 'epub',
  filename: 'Dune.epub',
} as const;
const download = { type: 'download', userId: 'u1', grantId: 'g1', bookId: 'abc123' } as const;

describe('transfer tickets', () => {
  it('round-trips an upload and a download ticket', () => {
    expect(verifyTransferTicket(secret, signTransferTicket(secret, upload), 'upload')).toEqual(
      upload
    );
    expect(verifyTransferTicket(secret, signTransferTicket(secret, download), 'download')).toEqual(
      download
    );
  });

  it('refuses a ticket presented as the other type', () => {
    expect(verifyTransferTicket(secret, signTransferTicket(secret, upload), 'download')).toBeNull();
    expect(verifyTransferTicket(secret, signTransferTicket(secret, download), 'upload')).toBeNull();
  });

  it('refuses an expired ticket, a foreign signature and garbage', () => {
    expect(
      verifyTransferTicket(secret, signTransferTicket(secret, download, -10), 'download')
    ).toBeNull();
    const other = crypto.randomBytes(32);
    expect(
      verifyTransferTicket(secret, signTransferTicket(other, download), 'download')
    ).toBeNull();
    expect(verifyTransferTicket(secret, 'not-a-jwt', 'download')).toBeNull();
  });

  it('is never accepted as a web access token, nor an access token as a ticket', () => {
    expect(verifyAccessToken(secret, signTransferTicket(secret, download))).toBeNull();

    const access = signAccessToken(secret, {
      userId: 'u1',
      username: 'alice',
      isAdmin: false,
      mustChangePassword: false,
      mustSetEmail: false,
    });
    expect(verifyTransferTicket(secret, access, 'download')).toBeNull();
  });

  it('refuses a correctly signed ticket missing its claims', () => {
    const bare = jwt.sign({ typ: 'download', gid: 'g1' }, secret, {
      algorithm: 'HS256',
      audience: 'bookplate-mcp-transfer',
      subject: 'u1',
    });
    expect(verifyTransferTicket(secret, bare, 'download')).toBeNull();
  });
});
