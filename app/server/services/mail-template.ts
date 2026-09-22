/**
 * Both messages, as data. Pure functions of their arguments — no config, no
 * clock, no I/O — so the tests read them directly and a caller cannot forget
 * to pass the library name.
 *
 * The code is the primary mechanism and appears unconditionally; the link is a
 * convenience that exists only when `publicUrl` is configured. A LAN-only
 * install is fully functional on codes alone, which is why the link is never
 * synthesised from a request header (see `AppConfig.publicUrl`).
 *
 * `html` is deliberately plain and inline-styled: mail clients strip
 * stylesheets, and a verification email is four lines of text with one code in
 * it — there is nothing here worth a layout.
 */
import type { MailMessage } from './mailer';
import type { NotificationPayload } from './notification';

export type TemplateArgs = {
  to: string;
  code: string;
  libraryName: string;
  publicUrl: string | null;
};

/** The library name is operator-supplied and interpolated into html. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function link(publicUrl: string | null, path: string, code: string): string | null {
  return publicUrl === null ? null : `${publicUrl}${path}?code=${encodeURIComponent(code)}`;
}

function render(args: {
  subject: string;
  to: string;
  lead: string;
  code: string;
  href: string | null;
  linkLabel: string;
  closing: string;
}): MailMessage {
  const textLines = [args.lead, '', args.code, ''];
  if (args.href !== null) textLines.push(`${args.linkLabel}: ${args.href}`, '');
  textLines.push(args.closing);

  const htmlParts = [
    `<p>${escapeHtml(args.lead)}</p>`,
    `<p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:24px;letter-spacing:3px;font-weight:600">${escapeHtml(args.code)}</p>`,
  ];
  if (args.href !== null) {
    htmlParts.push(`<p><a href="${escapeHtml(args.href)}">${escapeHtml(args.linkLabel)}</a></p>`);
  }
  htmlParts.push(`<p style="color:#666;font-size:13px">${escapeHtml(args.closing)}</p>`);

  return {
    to: args.to,
    subject: args.subject,
    text: textLines.join('\n'),
    html: htmlParts.join('\n'),
  };
}

export function verificationMessage(args: TemplateArgs): MailMessage {
  return render({
    to: args.to,
    subject: `Confirm your email address for ${args.libraryName}`,
    lead: `Enter this code in ${args.libraryName} to confirm this email address:`,
    code: args.code,
    href: link(args.publicUrl, '/set-email', args.code),
    linkLabel: 'Or confirm it here',
    closing:
      "This code expires in 24 hours. If you didn't add this address to " +
      `${args.libraryName}, you can ignore this email.`,
  });
}

export function passwordResetMessage(args: TemplateArgs): MailMessage {
  return render({
    to: args.to,
    subject: `Reset your ${args.libraryName} password`,
    lead: `Enter this code in ${args.libraryName} to choose a new password:`,
    code: args.code,
    href: link(args.publicUrl, '/reset-password', args.code),
    linkLabel: 'Or reset it here',
    closing:
      "This code expires in 1 hour and can be used once. If you didn't request a " +
      'password reset, you can ignore this email — nothing has changed.',
  });
}

/**
 * The second renderer. `render` above is built around a CODE and a
 * code-bearing link, which a notification has neither of — it has a short lead
 * and a few labelled lines. Shares `escapeHtml` and the same inline-styled,
 * deliberately plain html, for the reason recorded at the top of this file.
 *
 * `lines` entries are dropped when their value is empty, so an absent note or
 * decline reason leaves no orphaned label.
 */
function notice(args: {
  to: string;
  subject: string;
  lead: string;
  lines: Array<{ label: string; value: string }>;
  href: string | null;
  linkLabel: string;
  closing: string;
}): MailMessage {
  const present = args.lines.filter((line) => line.value.trim() !== '');

  const textLines = [args.lead, ''];
  for (const line of present) textLines.push(`${line.label}: ${line.value}`);
  textLines.push('');
  if (args.href !== null) textLines.push(`${args.linkLabel}: ${args.href}`, '');
  textLines.push(args.closing);

  const htmlParts = [`<p>${escapeHtml(args.lead)}</p>`];
  if (present.length > 0) {
    htmlParts.push(
      '<ul style="padding-left:18px">' +
        present
          .map(
            (line) =>
              `<li><strong>${escapeHtml(line.label)}:</strong> ${escapeHtml(line.value)}</li>`
          )
          .join('') +
        '</ul>'
    );
  }
  if (args.href !== null) {
    htmlParts.push(`<p><a href="${escapeHtml(args.href)}">${escapeHtml(args.linkLabel)}</a></p>`);
  }
  htmlParts.push(`<p style="color:#666;font-size:13px">${escapeHtml(args.closing)}</p>`);

  return {
    to: args.to,
    subject: args.subject,
    text: textLines.join('\n'),
    html: htmlParts.join('\n'),
  };
}

export type NoticeArgs = {
  to: string;
  libraryName: string;
  publicUrl: string | null;
  payload: NotificationPayload;
};

/**
 * All three notifications deep-link to the SAME surface, which serves the
 * reader's own request list and the admin's queue alike (`/add/request`).
 * `null` when `public_url` is unset, exactly as the code mails' link is — a
 * LAN-only install gets a fully useful message with no link, and no URL is
 * ever synthesised from a request header.
 */
function requestsLink(publicUrl: string | null): string | null {
  return publicUrl === null ? null : `${publicUrl}/add/request`;
}

export function bookRequestedMessage(args: NoticeArgs): MailMessage {
  return notice({
    to: args.to,
    subject: `${args.payload.requesterUsername} requested a book on ${args.libraryName}`,
    lead: `${args.payload.requesterUsername} asked for a book that isn't in ${args.libraryName} yet.`,
    lines: [
      { label: 'Title', value: args.payload.title },
      { label: 'Author', value: args.payload.author },
      { label: 'Note', value: args.payload.note },
    ],
    href: requestsLink(args.publicUrl),
    linkLabel: 'Review the request',
    closing: `You're receiving this because you're the ${args.libraryName} admin. You can turn these off on your account page.`,
  });
}

export function requestFulfilledMessage(args: NoticeArgs): MailMessage {
  return notice({
    to: args.to,
    subject: `${args.payload.title} has been added to your library`,
    lead: `Good news — the book you asked for is now in ${args.libraryName}.`,
    lines: [
      { label: 'Title', value: args.payload.title },
      { label: 'Author', value: args.payload.author },
    ],
    href: requestsLink(args.publicUrl),
    linkLabel: 'Open your library',
    closing: 'You can turn these emails off on your account page.',
  });
}

export function requestDeclinedMessage(args: NoticeArgs): MailMessage {
  return notice({
    to: args.to,
    subject: `Your request for ${args.payload.title} was declined`,
    lead: `The ${args.libraryName} admin turned down one of your book requests.`,
    lines: [
      { label: 'Title', value: args.payload.title },
      { label: 'Author', value: args.payload.author },
      { label: 'Reason', value: args.payload.declineReason },
    ],
    href: requestsLink(args.publicUrl),
    linkLabel: 'See your requests',
    closing: 'You can turn these emails off on your account page.',
  });
}
