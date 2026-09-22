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

it('truncates a long body to the budget', () => {
  const message = PUSH_TEMPLATES['book_request.created']({
    libraryName: 'Bookplate',
    payload: payload({ note: 'x'.repeat(1000) }),
  });

  expect(message.body.length).toBeLessThanOrEqual(BODY_BUDGET);
  expect(message.body.endsWith('…')).toBe(true);
});
