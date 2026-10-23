/**
 * Short-lived capability URLs for moving EPUB/cover bytes in and out of the
 * library on behalf of an MCP agent.
 *
 * WHY URLS AT ALL: MCP tool calls carry JSON, and an EPUB is megabytes. A model
 * cannot emit megabytes of base64 as a tool argument, and pulling a whole book
 * into its context as a tool result is useless to it. So the tools hand out a
 * URL instead, and the agent moves the bytes itself (`curl`), out of band.
 *
 * WHY THE CAPABILITY IS IN THE URL: the agent's bearer token lives in its MCP
 * client config, which the model usually cannot read — so it could not attach
 * `Authorization` to its own `curl`. The URL must authorize itself.
 *
 * A ticket is an HS256 JWT signed with the server's existing JWT secret. It
 * cannot be confused with a web access token in either direction:
 *  - it carries a distinct `aud` and no `username` claim, which
 *    `verifyAccessToken` requires, so it never authenticates the web API;
 *  - an access token has no `aud`, so `verifyTransferTicket` rejects it.
 *
 * It names the MCP token it was minted under (`tid`). The routes re-check that
 * token still exists (`mcpTokenIsLive`) before honouring a ticket, so revoking
 * a token also kills every URL handed out under it. Within its lifetime a ticket
 * is reusable — a retried `curl` should work — which is why that lifetime is
 * short.
 */
import jwt from 'jsonwebtoken';

export const TRANSFER_TICKET_TTL_SECONDS = 15 * 60;

const AUDIENCE = 'bookplate-mcp-transfer';

export type UploadKind = 'epub' | 'cover';

export type UploadTicket = {
  readonly type: 'upload';
  readonly userId: string;
  readonly tokenId: string;
  readonly kind: UploadKind;
  readonly filename: string;
};

export type DownloadTicket = {
  readonly type: 'download';
  readonly userId: string;
  readonly tokenId: string;
  /** The raw content-hash book id (the local half of `Book.id`). */
  readonly bookId: string;
};

export type TransferTicket = UploadTicket | DownloadTicket;

export function signTransferTicket(
  secret: Buffer,
  ticket: TransferTicket,
  ttlSeconds: number = TRANSFER_TICKET_TTL_SECONDS
): string {
  const claims =
    ticket.type === 'upload'
      ? { typ: 'upload', tid: ticket.tokenId, kind: ticket.kind, name: ticket.filename }
      : { typ: 'download', tid: ticket.tokenId, bid: ticket.bookId };
  return jwt.sign(claims, secret, {
    algorithm: 'HS256',
    audience: AUDIENCE,
    subject: ticket.userId,
    expiresIn: ttlSeconds,
  });
}

/** `null` for anything not a valid, unexpired ticket of the expected type. */
export function verifyTransferTicket<T extends TransferTicket['type']>(
  secret: Buffer,
  raw: string,
  expected: T
): Extract<TransferTicket, { type: T }> | null {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(raw, secret, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
    }) as jwt.JwtPayload;
  } catch {
    return null;
  }
  const { sub, tid, typ } = payload;
  if (typeof sub !== 'string' || typeof tid !== 'string' || typ !== expected) return null;

  if (typ === 'upload') {
    const { kind, name } = payload;
    if ((kind !== 'epub' && kind !== 'cover') || typeof name !== 'string') return null;
    const ticket: UploadTicket = {
      type: 'upload',
      userId: sub,
      tokenId: tid,
      kind,
      filename: name,
    };
    return ticket as Extract<TransferTicket, { type: T }>;
  }
  const { bid } = payload;
  if (typeof bid !== 'string') return null;
  const ticket: DownloadTicket = { type: 'download', userId: sub, tokenId: tid, bookId: bid };
  return ticket as Extract<TransferTicket, { type: T }>;
}
