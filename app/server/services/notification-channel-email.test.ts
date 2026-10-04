import { createFakeMailer, type FakeMailer } from '../test-support/mail';
import type { NotificationPayload, NotificationRecipient } from './notification';
import { createEmailChannelDriver } from './notification-channel-email';

vi.mock('../logger');

let mailer: FakeMailer;

const payload: NotificationPayload = {
  requesterUsername: 'alice',
  title: 'Dune',
  author: 'Frank Herbert',
  note: '',
  declineReason: '',
};

const verified: NotificationRecipient = {
  userId: 'u1',
  email: 'alice@example.com',
  emailVerifiedAt: 1000,
};

const driver = () =>
  createEmailChannelDriver({
    mailer,
    libraryName: 'Bookplate',
    publicUrl: 'https://books.example.com',
  });

beforeEach(() => {
  mailer = createFakeMailer();
});

describe('createEmailChannelDriver', () => {
  it('sends the matching template for each event', async () => {
    const d = driver();

    await d.deliver({ recipient: verified, event: 'book_request.created', payload });
    await d.deliver({ recipient: verified, event: 'book_request.fulfilled', payload });
    await d.deliver({ recipient: verified, event: 'book_request.declined', payload });

    expect(mailer.sent.map((m) => m.subject)).toEqual([
      'alice requested a book on Bookplate',
      'Dune has been added to your library',
      'Your request for Dune was declined',
    ]);
    expect(mailer.sent.every((m) => m.to === 'alice@example.com')).toBe(true);
  });

  it('refuses an unverified address as invalid_destination without sending', async () => {
    const result = await driver().deliver({
      recipient: { ...verified, emailVerifiedAt: null },
      event: 'book_request.fulfilled',
      payload,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_destination' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('refuses an absent address as invalid_destination without sending', async () => {
    const result = await driver().deliver({
      recipient: { ...verified, email: null },
      event: 'book_request.fulfilled',
      payload,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_destination' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('passes a mailer failure through unchanged', async () => {
    mailer.nextResult = { ok: false, reason: 'throttled' };

    const result = await driver().deliver({
      recipient: verified,
      event: 'book_request.fulfilled',
      payload,
    });

    expect(result).toEqual({ ok: false, reason: 'throttled' });
  });
});
