import type { NotificationPayload } from './notification';
import { BODY_BUDGET, PUSH_TEMPLATES } from './push-template';

const payload = (overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
  ...overrides,
});

it('renders the created notice for the admin', () => {
  const message = PUSH_TEMPLATES['book_request.created']({
    libraryName: 'Bookplate',
    payload: payload({ note: 'the 1965 edition please' }),
  });

  expect(message.title).toBe('alice requested a book');
  expect(message.body).toContain('Dune');
  expect(message.body).toContain('Frank Herbert');
  expect(message.url).toBe('/add/request');
});

it('renders the fulfilled and declined notices', () => {
  expect(
    PUSH_TEMPLATES['book_request.fulfilled']({
      libraryName: 'Bookplate',
      payload: payload(),
    }).title
  ).toBe('Dune was added to your library');

  expect(
    PUSH_TEMPLATES['book_request.declined']({
      libraryName: 'Bookplate',
      payload: payload({ declineReason: 'already own it' }),
    }).body
  ).toContain('already own it');
});

it('collapses a redelivered duplicate onto the same tag', () => {
  const args = { libraryName: 'Bookplate', payload: payload() };
  const first = PUSH_TEMPLATES['book_request.fulfilled'](args);
  const second = PUSH_TEMPLATES['book_request.fulfilled'](args);

  // The outbox is at-least-once by design; an identical tag means the second
  // delivery REPLACES the visible notification instead of stacking beside it.
  expect(second.tag).toBe(first.tag);
  expect(first.tag).toContain('book_request.fulfilled');
});

it('gives different requests different tags', () => {
  const a = PUSH_TEMPLATES['book_request.fulfilled']({
    libraryName: 'Bookplate',
    payload: payload({ title: 'Dune' }),
  });
  const b = PUSH_TEMPLATES['book_request.fulfilled']({
    libraryName: 'Bookplate',
    payload: payload({ title: 'Neuromancer' }),
  });

  expect(a.tag).not.toBe(b.tag);
});

describe('book_request.created tag (M-1)', () => {
  it('gives two different requesters asking for the SAME book different tags — the admin must learn about both', () => {
    const a = PUSH_TEMPLATES['book_request.created']({
      libraryName: 'Bookplate',
      payload: payload({ requesterUsername: 'alice', title: 'Dune' }),
    });
    const b = PUSH_TEMPLATES['book_request.created']({
      libraryName: 'Bookplate',
      payload: payload({ requesterUsername: 'bob', title: 'Dune' }),
    });

    expect(a.tag).not.toBe(b.tag);
  });

  it('still collapses a genuine redelivery — an at-least-once retry carries a byte-identical payload', () => {
    const args = {
      libraryName: 'Bookplate',
      payload: payload({ requesterUsername: 'alice', title: 'Dune' }),
    };
    const first = PUSH_TEMPLATES['book_request.created'](args);
    const second = PUSH_TEMPLATES['book_request.created'](args);

    expect(second.tag).toBe(first.tag);
  });
});

it('leaves fulfilled/declined tags unaffected by requesterUsername — they are per-subject, not fan-out', () => {
  const a = PUSH_TEMPLATES['book_request.fulfilled']({
    libraryName: 'Bookplate',
    payload: payload({ requesterUsername: 'alice', title: 'Dune' }),
  });
  const b = PUSH_TEMPLATES['book_request.fulfilled']({
    libraryName: 'Bookplate',
    payload: payload({ requesterUsername: 'bob', title: 'Dune' }),
  });

  // Only book_request.created folds in the requester — see tagFor's own doc
  // comment for why fulfilled/declined have no cross-reader collision to fix.
  expect(a.tag).toBe(b.tag);
});

it('truncates a long body to the budget', () => {
  const message = PUSH_TEMPLATES['book_request.created']({
    libraryName: 'Bookplate',
    payload: payload({ note: 'x'.repeat(1000) }),
  });

  expect(message.body.length).toBeLessThanOrEqual(BODY_BUDGET);
  expect(message.body.endsWith('…')).toBe(true);
});
