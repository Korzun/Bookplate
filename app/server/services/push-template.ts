/**
 * The three notifications as a phone sees them. Pure functions of their
 * arguments — no config beyond the library name, no clock, no I/O — so the
 * tests read them directly, exactly as `mail-template.ts`'s five are.
 *
 * Two things differ from the mail templates, both forced by the medium:
 *
 *  1. **`url` is relative.** The service worker is same-origin, so unlike the
 *     mails — which omit their link entirely when `public_url` is unset, and
 *     never synthesise one from a request header — a push notification is
 *     fully useful on an install that configured no public URL at all.
 *
 *  2. **`body` is truncated.** Web Push caps the ENCRYPTED payload at roughly
 *     4KB and rejects anything over it outright, so this is a hard limit, not
 *     a style choice. `BODY_BUDGET` is set well under the cap because the
 *     ciphertext is larger than the JSON it came from, and because a phone's
 *     notification shade truncates long text anyway. The full detail is one
 *     tap away behind `url`.
 */
import type { NotificationEvent, NotificationPayload } from './notification';

export type PushMessage = {
  title: string;
  body: string;
  /** Relative, and opened by the worker's `notificationclick` handler. */
  url: string;
  tag: string;
};

export type PushNoticeArgs = {
  libraryName: string;
  payload: NotificationPayload;
};

/**
 * Well under the ~4KB ciphertext cap, and about what a notification shade
 * shows before it elides. See the header.
 */
export const BODY_BUDGET = 180;

/**
 * Both surfaces — the reader's own list and the admin's queue — are here.
 *
 * `/request`, not the `/add/request` this was: that URL moved when Request
 * became its own nav destination, and the client no longer redirects it. A
 * notification is the app linking to ITSELF, so it has to track the route —
 * "nobody is holding a stale bookmark" does not cover links the app mints.
 */
const REQUESTS_PATH = '/request';

function truncate(value: string): string {
  if (value.length <= BODY_BUDGET) return value;
  return `${value.slice(0, BODY_BUDGET - 1).trimEnd()}…`;
}

function body(parts: readonly string[]): string {
  return truncate(parts.filter((part) => part.trim() !== '').join(' · '));
}

/**
 * The collapse key. Built from the event and the book so a REDELIVERY of the
 * same notification replaces the one already on screen rather than stacking a
 * second copy — `NotificationQueue`'s header documents that delivery is
 * at-least-once, and this is the lever that makes that cost invisible on this
 * channel. Deliberately NOT the outbox row id, which is unique per delivery
 * and would collapse nothing.
 *
 * `book_request.created` also folds in `payload.requesterUsername`. This
 * event alone fans out to the ADMIN for every reader's request, so
 * `event:title` collapsed two DIFFERENT readers requesting the same book onto
 * ONE notification, silently dropping the second reader's ask — the admin
 * never learned about it. Including the requester still collapses a genuine
 * REDELIVERY: the outbox retries the exact same payload byte-for-byte, so a
 * redelivered `book_request.created` carries the identical
 * `requesterUsername` and produces the identical tag, exactly as before.
 * `fulfilled`/`declined` are per-subject (one specific reader's own request)
 * and left alone — there is no cross-reader collision to fix there.
 */
function tagFor(event: NotificationEvent, payload: NotificationPayload): string {
  if (event === 'book_request.created') {
    return `${event}:${payload.title}:${payload.requesterUsername}`;
  }
  return `${event}:${payload.title}`;
}

export const PUSH_TEMPLATES: Record<NotificationEvent, (args: PushNoticeArgs) => PushMessage> = {
  'book_request.created': ({ payload }) => ({
    title: `${payload.requesterUsername} requested a book`,
    body: body([payload.title, payload.author, payload.note]),
    url: REQUESTS_PATH,
    tag: tagFor('book_request.created', payload),
  }),
  'book_request.fulfilled': ({ libraryName, payload }) => ({
    title: `${payload.title} was added to your library`,
    body: body([payload.author, `Now in ${libraryName}`]),
    url: REQUESTS_PATH,
    tag: tagFor('book_request.fulfilled', payload),
  }),
  'book_request.declined': ({ payload }) => ({
    title: `Your request for ${payload.title} was declined`,
    body: body([payload.author, payload.declineReason]),
    url: REQUESTS_PATH,
    tag: tagFor('book_request.declined', payload),
  }),
};
