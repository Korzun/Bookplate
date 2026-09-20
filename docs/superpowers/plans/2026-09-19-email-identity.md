# Email Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Bookplate account a verified email address it can log in with and reset its password through, delivered via Cloudflare Email Service.

**Architecture:** A narrow `Mailer` seam with one driver (Cloudflare REST over `fetch`) sits under two new flows — email verification (authenticated, GraphQL) and password forgot/reset (unauthenticated, REST beside `/api/login`). An address is required by policy, enforced at the login boundary by a `mustSetEmail` gate that mirrors the existing `mustChangePassword` gate, and only when mail is configured. The config-based admin gains a `users` row so it can hold an address, which requires five explicit guards because three files currently reason from "the admin has no row".

**Tech Stack:** TypeScript, Express 4, Prisma 7 + better-sqlite3, Pothos GraphQL (relay + scope-auth + prisma plugins), graphql-yoga, argon2, zod, vitest + supertest (server); React 19, Apollo Client, react-router, vitest + Testing Library (client).

**Spec:** `docs/superpowers/specs/2026-09-19-email-identity-design.md`

## Global Constraints

- **Working directory is the worktree:** `/Users/korzun/.herdr/worktrees/Bookplate/notifications`. Never `cd` to `/Users/korzun/Code/Bookplate` — the `run-tests` command file predates worktrees and names the main checkout.
- **Tests:** `cd app/server && npm test` (server), `cd app/client && npm test` (client).
- **Lint from the repo ROOT only:** `npm run lint`. Running it inside one workspace silently skips the other and has caused two CI failures.
- **Migrations are hand-written.** Never run `prisma migrate dev` — `prisma/schema.prisma` declares relations that emit no DDL and a generated migration would fail against existing rows.
- **New `users` columns and new tables go in a `data_v*` migration in `db/migrate.ts`, never the DDL pass** — `data_v10_user_surrogate_id` rebuilds `users` from an explicit column list and would silently drop them.
- **No new npm dependencies.** The Cloudflare driver uses global `fetch`.
- **GraphQL schema is checked in.** After any schema change run `npm run graphql:schema` (server) and the client's codegen; `npm run lint` runs `graphql:schema:check` and fails on drift.
- **Timestamps are `Float` ms-epoch** (`@map` to snake_case columns), matching every existing model.
- **Mail-unconfigured is the default state.** Every feature in this plan must be inert when `config.mail` is absent: no gate, no forgot link, no email login hint.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).

## File Structure

**New server files**

| File | Responsibility |
| --- | --- |
| `app/server/services/mailer.ts` | The `Mailer` seam: types, `createMailer`, `isMailConfigured`. No transport. |
| `app/server/services/mailer-cloudflare.ts` | The only driver. `fetch` → `SendResult` classification. |
| `app/server/services/mail-template.ts` | Verify + reset message bodies (text and html). Pure. |
| `app/server/services/email-token.ts` | Code generation, issue/upsert, consume, cooldown, invalidation. |
| `app/server/services/email.ts` | `normalizeEmail`, `setUserEmail`, `findUserByEmail`. |
| `app/server/services/admin-account.ts` | `ensureAdminUser`, and the single `NOT_CONFIG_ADMIN` predicate every guard imports. |
| `app/server/routes/password.ts` | `POST /api/password/forgot` and `/reset`, mounted by `routes/ui.ts`. |
| `app/server/graphql/schema/viewer/mutation/set-email.ts` | `viewerSetEmail`. |
| `app/server/graphql/schema/viewer/mutation/resend-email-verification.ts` | `viewerResendEmailVerification`. |
| `app/server/graphql/schema/viewer/mutation/confirm-email.ts` | `viewerConfirmEmail`. |
| `app/server/graphql/schema/email-in-use-error/model.ts` | Typed failure for an `emailKey` collision. |
| `app/server/graphql/schema/email-not-configured-error/model.ts` | Typed failure when mail is off. |

**Modified server files**

`types.ts` (AppConfig.mail), `config.ts` (load + validate), `services/jwt.ts` (`mustSetEmail` claim), `middleware/auth.ts` (`emailSetupGate`), `routes/ui.ts` (login identifier, G1, `createIpRateLimit`, mount password routes, `public-config`), `services/token.ts` (`deleteExpired` sweep), `db/migrate.ts` (`data_v19_user_email`), `prisma/schema.prisma`, `graphql/context.ts` (`Viewer.mustSetEmail`, `mailer`), `graphql/schema/builder.ts` (`emailSetupAllowed`), `graphql/schema/viewer/model.ts` (`email`, `emailVerifiedAt`), `graphql/schema/user/mutation/{delete,reset-password}.ts` (G2 + G5), `graphql/schema/viewer/mutation/regenerate-sync-password.ts` (G3), `index.ts` (`ensureAdminUser`, mailer construction), `server.ts` (mailer wiring), `config.yaml`, `README.md`.

**New client files**

`page/set-email/{index.tsx,style.ts,index.test.tsx}`, `page/forgot-password/{index.tsx,style.ts,index.test.tsx}`, `page/reset-password/{index.tsx,style.ts,index.test.tsx}`, `provider/auth/hook/use-must-set-email.ts`, `component/email-setting/{index.tsx,style.ts,index.test.tsx}`.

**Modified client files**

`lib/token.ts` (claim), `provider/auth/hook/index.ts`, `provider/auth/index.ts`, `router/{path.ts,path-internal.ts,component.tsx,protected-route.tsx}`, `page/index.ts`, `page/login/index.tsx`, `page/user/index.tsx`, `graphql/viewer-bootstrap.ts`, `graphql/user.ts`.

**Naming trap:** `page/password-reset` already exists and is the *forced password change* screen. The new pages are `page/forgot-password` and `page/reset-password`. Do not touch `page/password-reset`.

---

### Task 1: Mail configuration

**Files:**
- Modify: `app/server/types.ts:98-128` (add `mail`, `publicUrl` to `AppConfig`)
- Modify: `app/server/config.ts` (`Options` interface, defaults, `options.json` merge, return)
- Modify: `config.yaml` (`options` + `schema`)
- Modify: `README.md` (add-on option table, env-var table)
- Test: `app/server/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MailConfig = { accountId: string; apiToken: string; from: string; fromName: string }`, exported from `types.ts`; `AppConfig.mail?: MailConfig | null`; `AppConfig.publicUrl?: string | null`.

`mail` and `publicUrl` are **optional**, not required, for the same reason `trustProxyHops` is: every `AppConfig` literal in the test suite would otherwise need updating.

- [ ] **Step 1: Write the failing tests**

Append to `app/server/config.test.ts`:

```ts
describe('mail config', () => {
  it('is null when nothing is set', () => {
    const config = loadConfig();
    expect(config.mail ?? null).toBeNull();
  });

  it('is null when only some fields are set', () => {
    process.env.CF_ACCOUNT_ID = 'acct';
    process.env.CF_API_TOKEN = 'token';
    // no EMAIL_FROM
    expect(loadConfig().mail ?? null).toBeNull();
  });

  it('is populated when all three required fields are set', () => {
    process.env.CF_ACCOUNT_ID = 'acct';
    process.env.CF_API_TOKEN = 'token';
    process.env.EMAIL_FROM = 'library@example.com';
    expect(loadConfig().mail).toEqual({
      accountId: 'acct',
      apiToken: 'token',
      from: 'library@example.com',
      fromName: 'Bookplate',
    });
  });

  it('defaults fromName to the library name', () => {
    process.env.LIBRARY_NAME = 'My Books';
    process.env.CF_ACCOUNT_ID = 'acct';
    process.env.CF_API_TOKEN = 'token';
    process.env.EMAIL_FROM = 'library@example.com';
    expect(loadConfig().mail?.fromName).toBe('My Books');
  });

  it('treats whitespace-only values as unset', () => {
    process.env.CF_ACCOUNT_ID = '  ';
    process.env.CF_API_TOKEN = 'token';
    process.env.EMAIL_FROM = 'library@example.com';
    expect(loadConfig().mail ?? null).toBeNull();
  });

  it('accepts a well-formed public URL and strips a trailing slash', () => {
    process.env.PUBLIC_URL = 'https://books.example.com/';
    expect(loadConfig().publicUrl).toBe('https://books.example.com');
  });

  it('rejects a malformed public URL rather than emitting a broken link', () => {
    process.env.PUBLIC_URL = 'books.example.com';
    expect(loadConfig().publicUrl ?? null).toBeNull();
  });

  it('rejects a non-http scheme', () => {
    process.env.PUBLIC_URL = 'javascript:alert(1)';
    expect(loadConfig().publicUrl ?? null).toBeNull();
  });
});
```

Follow the file's existing env-var hygiene: whatever `beforeEach`/`afterEach` it already uses to save and restore `process.env`, reuse it. If it has none, add `afterEach(() => { process.env = { ...savedEnv }; })` with `savedEnv` captured in `beforeAll`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run config.test.ts`
Expected: FAIL — `config.mail` is `undefined` where an object is expected, and `publicUrl` does not exist.

- [ ] **Step 3: Add the types**

In `app/server/types.ts`, above `AppConfig`:

```ts
/**
 * Cloudflare Email Service credentials. Present only when all three required
 * fields are non-blank — `loadConfig` collapses any partial configuration to
 * `null`, so "is mail configured?" is one check with one answer rather than
 * three fields tested at every call site.
 */
export interface MailConfig {
  accountId: string;
  apiToken: string;
  /** Must be on a domain verified for Email Sending in that Cloudflare account. */
  from: string;
  fromName: string;
}
```

Inside `AppConfig`, after `trustProxyHops`:

```ts
  /**
   * `null`/absent means email is switched off entirely: no set-email gate, no
   * verification, no password reset by email, and no forgot-password affordance
   * in the client. Optional rather than required for the same reason
   * `trustProxyHops` is — every `AppConfig` literal in the test suite predates it.
   */
  mail?: MailConfig | null;
  /**
   * Absolute origin this instance is reachable at, used ONLY to add a clickable
   * link beside the typed code in verification and reset emails. Absent means
   * code-only delivery, which is fully functional. Never derived from a request
   * header: a `Host`-derived link is the classic reset-link poisoning path.
   */
  publicUrl?: string | null;
```

- [ ] **Step 4: Load and validate them**

In `app/server/config.ts`, add to the `Options` interface:

```ts
  email_cloudflare_account_id: string;
  email_cloudflare_api_token: string;
  email_from_address: string;
  email_from_name: string;
  public_url: string;
```

Add `''` defaults for all five in the `options` literal, and the five `parsed.x ?? options.x` lines in the `options.json` merge.

Add these helpers above `loadConfig`:

```ts
/** Trimmed value, or `''` for anything blank/missing — the "unset" spelling everywhere below. */
function trimmed(raw: string | undefined): string {
  return (raw ?? '').trim();
}

/**
 * Collapses a partial mail configuration to `null`. Account id, token and
 * from-address are all required; `fromName` falls back to the library name so
 * an operator setting the minimum still gets a sensible From display name.
 */
function parseMailConfig(
  accountId: string,
  apiToken: string,
  from: string,
  fromName: string,
  libraryName: string
): MailConfig | null {
  if (!accountId || !apiToken || !from) return null;
  return { accountId, apiToken, from, fromName: fromName || libraryName };
}

/**
 * Accepts only an absolute http(s) origin, and returns it without a trailing
 * slash so callers can concatenate a path unconditionally. Anything else is
 * `null` WITH A WARNING rather than a throw: a malformed value degrades to
 * code-only email, which works, instead of failing the whole boot or — far
 * worse — emitting a link nobody can follow.
 */
function parsePublicUrl(raw: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log.warn(`public_url "${raw}" is not an absolute URL, using code-only email`);
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    log.warn(`public_url "${raw}" is not http(s), using code-only email`);
    return null;
  }
  return url.origin;
}
```

In `loadConfig`'s return, after `trustProxyHops` (note `libraryName` is computed in the same literal, so recompute it into a local above the return and use it for both fields):

```ts
    mail: parseMailConfig(
      trimmed(process.env.CF_ACCOUNT_ID ?? options.email_cloudflare_account_id),
      trimmed(process.env.CF_API_TOKEN ?? options.email_cloudflare_api_token),
      trimmed(process.env.EMAIL_FROM ?? options.email_from_address),
      trimmed(process.env.EMAIL_FROM_NAME ?? options.email_from_name),
      libraryName
    ),
    publicUrl: parsePublicUrl(trimmed(process.env.PUBLIC_URL ?? options.public_url)),
```

Import `MailConfig` from `./types`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run config.test.ts`
Expected: PASS (all 8 new cases plus the file's existing ones).

- [ ] **Step 6: Add the add-on options**

In `config.yaml`, under `options:` add the five keys with empty-string values:

```yaml
  email_cloudflare_account_id: ""
  email_cloudflare_api_token: ""
  email_from_address: ""
  email_from_name: ""
  public_url: ""
```

and under `schema:`:

```yaml
  email_cloudflare_account_id: "str?"
  email_cloudflare_api_token: "password?"
  email_from_address: "str?"
  email_from_name: "str?"
  public_url: "str?"
```

`password?` (not `str?`) for the token: Home Assistant masks `password`-typed options in the add-on configuration UI, and this value is a live API credential.

- [ ] **Step 7: Document them**

Add five rows to `README.md`'s add-on option table and five to the "Environment variables (dev / bare-metal)" table, stating for each: all three of account id / token / from-address are required together, the from-address must be on a domain verified for Email Sending in that Cloudflare account, the token needs the **Email Sending: Edit** permission, and `public_url` is optional and only adds a clickable link beside the code that every email already carries.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add app/server/types.ts app/server/config.ts app/server/config.test.ts config.yaml README.md
git commit -m "feat(server): add Cloudflare Email Service configuration"
```

---

### Task 2: The Mailer seam and its Cloudflare driver

**Files:**
- Create: `app/server/services/mailer.ts`
- Create: `app/server/services/mailer-cloudflare.ts`
- Test: `app/server/services/mailer.test.ts`
- Test: `app/server/services/mailer-cloudflare.test.ts`

**Interfaces:**
- Consumes: `MailConfig` from Task 1.
- Produces:

```ts
export type MailMessage = { to: string; subject: string; text: string; html: string };
export type SendFailure = 'bad_address' | 'throttled' | 'misconfigured' | 'transient';
export type SendResult = { ok: true } | { ok: false; reason: SendFailure };
export type Mailer = { send(message: MailMessage): Promise<SendResult> };
export function createMailer(mail: MailConfig | null | undefined): Mailer | null;
export function isMailConfigured(config: Pick<AppConfig, 'mail'>): boolean;
export function createCloudflareMailer(mail: MailConfig): Mailer;  // mailer-cloudflare.ts
```

- [ ] **Step 1: Write the failing driver tests**

Create `app/server/services/mailer-cloudflare.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCloudflareMailer } from './mailer-cloudflare';

const MAIL = { accountId: 'acct', apiToken: 'tok', from: 'lib@example.com', fromName: 'Lib' };
const MESSAGE = { to: 'reader@example.com', subject: 'Hi', text: 'plain', html: '<p>plain</p>' };

const stubFetch = (impl: (url: string, init: RequestInit) => unknown) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

const json = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createCloudflareMailer', () => {
  it('posts to the account send endpoint with a bearer token', async () => {
    const fetchMock = stubFetch(() => json(200, { success: true, result: { delivered: [MESSAGE.to] } }));

    const result = await createCloudflareMailer(MAIL).send(MESSAGE);

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/email/sending/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'reader@example.com',
      from: 'Lib <lib@example.com>',
      subject: 'Hi',
      text: 'plain',
      html: '<p>plain</p>',
    });
  });

  it('reports a permanent bounce inside a 200 as a bad address', async () => {
    stubFetch(() =>
      json(200, { success: true, result: { delivered: [], permanent_bounces: [MESSAGE.to] } })
    );
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'bad_address',
    });
  });

  it.each([401, 403])('reports %i as misconfigured', async (status) => {
    stubFetch(() => json(status, { success: false, errors: [{ code: 10000, message: 'no' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'misconfigured',
    });
  });

  it('reports 429 as throttled', async () => {
    stubFetch(() => json(429, { success: false, errors: [{ code: 10004, message: 'rate' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'throttled',
    });
  });

  it('reports a 500 as transient', async () => {
    stubFetch(() => json(500, { success: false, errors: [] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('reports a network failure as transient rather than throwing', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('reports a 400 with a success:false body as transient, not a bad address', async () => {
    stubFetch(() => json(400, { success: false, errors: [{ code: 1, message: 'bad content' }] }));
    expect(await createCloudflareMailer(MAIL).send(MESSAGE)).toEqual({
      ok: false,
      reason: 'transient',
    });
  });

  it('logs a misconfiguration only once per mailer instance', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(() => json(401, { success: false, errors: [] }));
    const mailer = createCloudflareMailer(MAIL);
    await mailer.send(MESSAGE);
    await mailer.send(MESSAGE);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Email Sending'))).toHaveLength(1);
  });
});
```

The last test spies on `console.error` because `logger('Mailer').error` writes there; check `logger.ts` and match whichever console method the `error` level uses.

- [ ] **Step 2: Write the failing seam tests**

Create `app/server/services/mailer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createMailer, isMailConfigured } from './mailer';

const MAIL = { accountId: 'a', apiToken: 't', from: 'f@example.com', fromName: 'F' };

describe('createMailer', () => {
  it('returns null when mail is null', () => {
    expect(createMailer(null)).toBeNull();
  });

  it('returns null when mail is undefined', () => {
    expect(createMailer(undefined)).toBeNull();
  });

  it('returns a sender when mail is configured', () => {
    expect(typeof createMailer(MAIL)?.send).toBe('function');
  });
});

describe('isMailConfigured', () => {
  it('is false for an absent or null mail config', () => {
    expect(isMailConfigured({})).toBe(false);
    expect(isMailConfigured({ mail: null })).toBe(false);
  });

  it('is true for a populated mail config', () => {
    expect(isMailConfigured({ mail: MAIL })).toBe(true);
  });
});
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `cd app/server && npx vitest run services/mailer.test.ts services/mailer-cloudflare.test.ts`
Expected: FAIL — cannot resolve `./mailer` or `./mailer-cloudflare`.

- [ ] **Step 4: Write the seam**

Create `app/server/services/mailer.ts`:

```ts
/**
 * The one channel interface. Everything above it — verification, password
 * reset, and (next spec) notifications — depends on `Mailer` and never on a
 * transport, so a second channel (SMTP, web push) is an additive driver plus a
 * `createMailer` branch, with no change above this line.
 *
 * `createMailer` returning `null` for an unconfigured install is deliberate and
 * load-bearing: "is mail available?" becomes a single nullable value resolved
 * once at boot, rather than three credential fields re-tested at every call
 * site. Callers branch on the null, and the type system makes them.
 */
import type { AppConfig, MailConfig } from '../types';
import { createCloudflareMailer } from './mailer-cloudflare';

export type MailMessage = {
  to: string;
  subject: string;
  /** Always populated. Some clients never render the html part. */
  text: string;
  html: string;
};

/**
 * `bad_address` is a delivery verdict about the recipient, not a fault: it
 * arrives inside a `200` as a permanent bounce, and the caller should tell the
 * user their address is wrong. The other three are faults, distinguished
 * because each wants different handling — `misconfigured` is the operator's
 * problem, `throttled` and `transient` are worth retrying by hand.
 */
export type SendFailure = 'bad_address' | 'throttled' | 'misconfigured' | 'transient';
export type SendResult = { ok: true } | { ok: false; reason: SendFailure };

export type Mailer = { send(message: MailMessage): Promise<SendResult> };

export function createMailer(mail: MailConfig | null | undefined): Mailer | null {
  if (!mail) return null;
  return createCloudflareMailer(mail);
}

/**
 * The predicate every gate, resolver and route uses to ask whether email exists
 * on this install. Takes the config rather than the mailer so callers holding
 * only `context.config` (every GraphQL resolver) can ask without a mailer in
 * scope.
 */
export function isMailConfigured(config: Pick<AppConfig, 'mail'>): boolean {
  return (config.mail ?? null) !== null;
}
```

- [ ] **Step 5: Write the driver**

Create `app/server/services/mailer-cloudflare.ts`:

```ts
/**
 * Cloudflare Email Service (Email Sending, public beta 2026-04-16) over its
 * REST API. Global `fetch`, so this adds no dependency.
 *
 * Every non-success path is CLASSIFIED rather than passed through, because the
 * four outcomes want four different reactions and the HTTP status alone does
 * not separate them: a `200` can still report a permanent bounce, which is a
 * fact about the recipient's address, while a `401` is a fact about the
 * operator's token. Callers act on `SendResult.reason` and never see a status
 * code or a Cloudflare error body.
 */
import { logger } from '../logger';
import type { MailConfig } from '../types';
import type { Mailer, MailMessage, SendResult } from './mailer';

const log = logger('Mailer');

const SEND_URL = (accountId: string): string =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`;

type SendResponse = {
  success?: boolean;
  result?: { delivered?: string[]; permanent_bounces?: string[]; queued?: string[] };
  errors?: { code?: number; message?: string }[];
};

export function createCloudflareMailer(mail: MailConfig): Mailer {
  // Per-instance, not per-module: a misconfigured token produces a failure on
  // EVERY send, and one log line per process is enough to diagnose it. Without
  // this latch a notification fan-out (next spec) would write one line per
  // recipient per event.
  let misconfigurationLogged = false;

  return {
    async send(message: MailMessage): Promise<SendResult> {
      let response: Response;
      try {
        response = await fetch(SEND_URL(mail.accountId), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${mail.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: message.to,
            from: `${mail.fromName} <${mail.from}>`,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
      } catch (err) {
        log.warn(`Send failed (network): ${err instanceof Error ? err.message : String(err)}`);
        return { ok: false, reason: 'transient' };
      }

      if (response.status === 401 || response.status === 403) {
        if (!misconfigurationLogged) {
          misconfigurationLogged = true;
          log.error(
            'Cloudflare rejected the Email Sending credentials (401/403). Check the API token ' +
              'has the "Email Sending: Edit" permission and that the from-address is on a ' +
              'domain verified in this account. Email is effectively disabled until fixed.'
          );
        }
        return { ok: false, reason: 'misconfigured' };
      }
      if (response.status === 429) {
        log.warn('Cloudflare rate-limited the send (429)');
        return { ok: false, reason: 'throttled' };
      }

      let body: SendResponse;
      try {
        body = (await response.json()) as SendResponse;
      } catch {
        body = {};
      }

      if (!response.ok || body.success !== true) {
        log.warn(
          `Send failed (${response.status}): ${body.errors?.map((e) => e.message).join('; ') ?? 'no detail'}`
        );
        return { ok: false, reason: 'transient' };
      }
      if (body.result?.permanent_bounces?.length) {
        log.warn('Send bounced permanently — recipient address rejected');
        return { ok: false, reason: 'bad_address' };
      }
      return { ok: true };
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run services/mailer.test.ts services/mailer-cloudflare.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add app/server/services/mailer.ts app/server/services/mailer-cloudflare.ts app/server/services/mailer.test.ts app/server/services/mailer-cloudflare.test.ts
git commit -m "feat(server): add the Mailer seam and its Cloudflare driver"
```

---

### Task 3: Message templates

**Files:**
- Create: `app/server/services/mail-template.ts`
- Test: `app/server/services/mail-template.test.ts`

**Interfaces:**
- Consumes: `MailMessage` from Task 2.
- Produces:

```ts
export function verificationMessage(args: TemplateArgs): MailMessage;
export function passwordResetMessage(args: TemplateArgs): MailMessage;
export type TemplateArgs = {
  to: string;
  code: string;
  libraryName: string;
  /** Absolute origin, or null for code-only delivery. `AppConfig.publicUrl`. */
  publicUrl: string | null;
};
```

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/mail-template.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { passwordResetMessage, verificationMessage } from './mail-template';

const BASE = { to: 'reader@example.com', code: 'K7M2QX4P', libraryName: 'My Books' };

describe('verificationMessage', () => {
  it('always carries the code in both parts', () => {
    const message = verificationMessage({ ...BASE, publicUrl: null });
    expect(message.text).toContain('K7M2QX4P');
    expect(message.html).toContain('K7M2QX4P');
    expect(message.to).toBe('reader@example.com');
  });

  it('names the library in the subject so a reader with two instances can tell them apart', () => {
    expect(verificationMessage({ ...BASE, publicUrl: null }).subject).toContain('My Books');
  });

  it('omits any link when no public URL is configured', () => {
    const message = verificationMessage({ ...BASE, publicUrl: null });
    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('href');
  });

  it('includes a verify link carrying the code when a public URL is configured', () => {
    const message = verificationMessage({ ...BASE, publicUrl: 'https://books.example.com' });
    expect(message.text).toContain('https://books.example.com/set-email?code=K7M2QX4P');
    expect(message.html).toContain('href="https://books.example.com/set-email?code=K7M2QX4P"');
  });
});

describe('passwordResetMessage', () => {
  it('links to the reset page, not the verify page', () => {
    const message = passwordResetMessage({ ...BASE, publicUrl: 'https://books.example.com' });
    expect(message.text).toContain('https://books.example.com/reset-password?code=K7M2QX4P');
  });

  it('states that the code expires and that an unrequested mail can be ignored', () => {
    const message = passwordResetMessage({ ...BASE, publicUrl: null });
    expect(message.text.toLowerCase()).toContain('expire');
    expect(message.text.toLowerCase()).toContain("didn't request");
  });

  it('escapes the library name in the html part', () => {
    const message = passwordResetMessage({
      ...BASE,
      libraryName: '<script>x</script>',
      publicUrl: null,
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run services/mail-template.test.ts`
Expected: FAIL — cannot resolve `./mail-template`.

- [ ] **Step 3: Write the templates**

Create `app/server/services/mail-template.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run services/mail-template.test.ts`
Expected: PASS. If the "omits any link" test fails on the word "http" appearing in a style attribute, keep the assertion and remove the offending attribute — the template must contain no URL at all when `publicUrl` is null.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add app/server/services/mail-template.ts app/server/services/mail-template.test.ts
git commit -m "feat(server): add verification and password-reset message templates"
```

---
### Task 4: Schema and migration

**Files:**
- Modify: `app/server/prisma/schema.prisma` (`User` model, new `EmailToken` model)
- Create: `app/server/prisma/migrations/20260919000000_add_user_email/migration.sql` (no-op)
- Modify: `app/server/db/migrate.ts` (append `data_v19_user_email` as the LAST data migration)
- Test: `app/server/db/migrate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `User.email`, `User.emailKey`, `User.emailVerifiedAt`, `User.isConfigAdmin`, and the `EmailToken` model, all available on the generated Prisma client.

- [ ] **Step 1: Write the failing migration tests**

Add to `app/server/db/migrate.test.ts`, following whatever helper that file already uses to build a temp database and run `migrate` (reuse it exactly; do not invent a second harness):

```ts
describe('data_v19_user_email', () => {
  it('adds the email columns to users', async () => {
    const { prisma } = await freshDatabase();
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(users)`;
    const names = cols.map((c) => c.name);
    expect(names).toContain('email');
    expect(names).toContain('email_key');
    expect(names).toContain('email_verified_at');
    expect(names).toContain('is_config_admin');
  });

  it('creates the email_tokens table', async () => {
    const { prisma } = await freshDatabase();
    const tables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'email_tokens'
    `;
    expect(tables).toHaveLength(1);
  });

  it('enforces case-insensitive uniqueness through email_key', async () => {
    const { prisma } = await freshDatabase();
    await prisma.user.create({
      data: { id: 'u1', username: 'ann', email: 'Ann@Example.com', emailKey: 'ann@example.com' },
    });
    await expect(
      prisma.user.create({
        data: { id: 'u2', username: 'bob', email: 'ANN@example.com', emailKey: 'ann@example.com' },
      })
    ).rejects.toThrow();
  });

  it('permits many users with no address at all', async () => {
    const { prisma } = await freshDatabase();
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    expect(await prisma.user.count()).toBe(2);
  });

  it('is idempotent across a second run', async () => {
    const { prisma, run } = await freshDatabase();
    await expect(run()).resolves.not.toThrow();
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(users)`;
    expect(cols.filter((c) => c.name === 'email')).toHaveLength(1);
  });

  it('keeps the columns on a database that starts pre-v10', async () => {
    // The regression this migration exists to avoid: data_v10_user_surrogate_id
    // rebuilds `users` from an explicit column list, so anything added during
    // the DDL pass is dropped. Build a legacy-shaped database, run the whole
    // migrator, and assert the columns survived.
    const { prisma } = await legacyDatabasePreV10();
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(users)`;
    expect(cols.map((c) => c.name)).toContain('email');
  });
});
```

If `migrate.test.ts` has no `legacyDatabasePreV10` equivalent, build one from the oldest fixture the file already knows how to make; if it truly has no legacy-shape harness, assert instead that `data_v19_user_email` is registered *after* `data_v10_user_surrogate_id` by reading the source order:

```ts
it('is registered after data_v10_user_surrogate_id', () => {
  const source = fs.readFileSync(path.join(__dirname, 'migrate.ts'), 'utf-8');
  expect(source.indexOf('data_v19_user_email')).toBeGreaterThan(
    source.indexOf("'data_v10_user_surrogate_id'")
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run db/migrate.test.ts`
Expected: FAIL — `email` is not a known column, and `prisma.user.create` rejects `email` as an unknown argument.

- [ ] **Step 3: Update the Prisma schema**

In `app/server/prisma/schema.prisma`, add to `model User` (keep the existing field alignment):

```prisma
  email              String?           // as entered; display and send target
  emailKey           String?           @unique @map("email_key")
  emailVerifiedAt    Float?            @map("email_verified_at")
  isConfigAdmin      Boolean           @default(false) @map("is_config_admin")
  emailTokens        EmailToken[]
```

with this comment above `email`:

```prisma
  // `emailKey` is `email` trimmed and lowercased, and is what EVERY lookup uses
  // — login by address, forgot-password, uniqueness. Storing the derived key
  // gets case-insensitive uniqueness from a plain `@unique`, where the
  // alternative (a `lower(email)` expression index) is something Prisma cannot
  // model and the client would not know about. Same derived-key convention as
  // `Book.titleSort`, `Series.sortKey` and `BookRequest.dedupeKey`.
  //
  // Nullable although an address is REQUIRED: "required" is a policy enforced at
  // the login boundary (see `mustSetEmail`), exactly as `mustChangePassword` is,
  // and SQLite permits any number of NULLs in a unique index — which is what
  // lets every pre-upgrade row coexist without a placeholder address.
  //
  // `isConfigAdmin` marks the row mirroring the add-on options admin. That row
  // is identity-attached data ONLY: its token carries no `sub`, it is excluded
  // from every user listing, and three mutations refuse it outright. See
  // `services/admin-account.ts`.
```

Add the new model after `RefreshToken`:

```prisma
// One outstanding token per user per purpose — the primary key IS the identity,
// not `tokenHash`, because every consumption path already knows which account it
// acts on (confirm is authenticated; reset submits the address alongside the
// code). Three consequences, all deliberate: a guessed code is worthless without
// the matching account, "resend" is an upsert that invalidates the previous code
// rather than accumulating live ones, and the send counters below need no
// separate table.
//
// `email` records the address the code was sent to, so a reset token stops
// working the moment the account's address changes.
model EmailToken {
  userId    String @map("user_id")
  purpose   String
  tokenHash String @map("token_hash")
  email     String
  expiresAt Float  @map("expires_at")
  createdAt Float  @map("created_at")
  sentAt    Float  @map("sent_at")
  sendCount Int    @default(1) @map("send_count")
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@id([userId, purpose])
  @@index([expiresAt])
  @@map("email_tokens")
}
```

- [ ] **Step 4: Write the no-op DDL migration**

Create `app/server/prisma/migrations/20260919000000_add_user_email/migration.sql`:

```sql
-- This migration is intentionally a no-op.
--
-- The users email columns and the email_tokens table are created by the
-- data_v19_user_email data migration in migrate.ts instead, because
-- data_v10_user_surrogate_id REBUILDS "users" through a "users_new" table with
-- an explicit column list. A column added here, during the plain DDL migration
-- pass, would be silently dropped when v10 later runs on a database that has
-- not reached it yet.
--
-- Same reason, same shape, as 20260725000000_add_pending_fixes,
-- 20260726120000_add_validation_tables and 20260830000000_add_book_requests.
SELECT 1;
```

- [ ] **Step 5: Write the data migration**

Append to `db/migrate.ts`, after the `data_v18_book_requests` block and inside the same function:

```ts
  // Data migration: users email columns + the email_tokens table. Runs after
  // data_v10_user_surrogate_id, which rebuilds "users" from an explicit column
  // list and would drop anything the DDL pass added. The Prisma DDL migration
  // (20260919000000_add_user_email) is a no-op; see its comment.
  //
  // The PRAGMA guards make each ALTER re-runnable: runDataMigration only records
  // the name AFTER the body resolves, so a body that fails halfway runs again on
  // the next boot and must tolerate its own partial work.
  await runDataMigration(prisma, 'data_v19_user_email', async () => {
    const cols = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info(users)`;
    const has = (name: string): boolean => cols.some((c) => c.name === name);

    if (!has('email')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "email" TEXT`);
    }
    if (!has('email_key')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "email_key" TEXT`);
    }
    if (!has('email_verified_at')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "email_verified_at" REAL`);
    }
    if (!has('is_config_admin')) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "users" ADD COLUMN "is_config_admin" BOOLEAN NOT NULL DEFAULT 0`
      );
    }
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key_key" ON "users" ("email_key")`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "email_tokens" (
        "user_id" TEXT NOT NULL,
        "purpose" TEXT NOT NULL,
        "token_hash" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "expires_at" REAL NOT NULL,
        "created_at" REAL NOT NULL,
        "sent_at" REAL NOT NULL,
        "send_count" INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY ("user_id", "purpose"),
        CONSTRAINT "email_tokens_user_fkey" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "email_tokens_expires_at_idx" ON "email_tokens" ("expires_at")`
    );
  });
```

The unique index name `users_email_key_key` is the name Prisma derives for `@unique` on `emailKey` (`<table>_<column>_key`). Matching it keeps `prisma db pull`/introspection agreeing with the schema file.

- [ ] **Step 6: Regenerate the client and run the tests**

Run:
```bash
cd app/server && npm run prisma:generate && npx vitest run db/migrate.test.ts
```
Expected: PASS.

- [ ] **Step 7: Run the whole server suite**

Run: `cd app/server && npm test`
Expected: PASS. A new nullable column and a new table break nothing; if anything fails here it is a test asserting an exact column list, which should be updated to include the new columns.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add app/server/prisma app/server/db/migrate.ts app/server/db/migrate.test.ts
git commit -m "feat(server): add user email columns and the email_tokens table"
```

---

### Task 5: Email token service

**Files:**
- Create: `app/server/services/email-token.ts`
- Test: `app/server/services/email-token.test.ts`
- Modify: `app/server/services/token.ts` (`deleteExpired` also sweeps email tokens)
- Modify: `app/server/services/token.test.ts`

**Interfaces:**
- Consumes: the `EmailToken` model from Task 4.
- Produces:

```ts
export type EmailTokenPurpose = 'verify' | 'reset';
export const VERIFY_TTL_MS: number;        // 24h
export const RESET_TTL_MS: number;         // 1h
export const RESEND_COOLDOWN_MS: number;   // 60s
export const SEND_WINDOW_MS: number;       // 1h
export const MAX_SENDS_PER_WINDOW: number; // 5
export function generateEmailCode(): string;
export function hashEmailCode(code: string): string;
export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'cooldown' | 'send_cap'; retryAfterMs: number };
export function issueEmailToken(prisma: PrismaClient, args: {
  userId: string; purpose: EmailTokenPurpose; email: string; now?: number;
}): Promise<IssueResult>;
export function consumeEmailToken(prisma: PrismaClient, args: {
  userId: string; purpose: EmailTokenPurpose; code: string; now?: number;
}): Promise<{ email: string } | null>;
export function invalidateEmailTokens(
  prisma: PrismaClient, userId: string, purpose?: EmailTokenPurpose
): Promise<void>;
export function deleteExpiredEmailTokens(prisma: PrismaClient, now?: number): Promise<void>;
```

**Note for the spec:** the cap is **5 sends per rolling hour**, not per token lifetime. Update that phrase in the spec's "Security and rate limits" section in this task's commit — a per-lifetime cap would strand a user whose mail went to spam for the token's full 24-hour TTL.

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/email-token.test.ts`. Use the same in-memory/temp Prisma harness the other service tests use (`test-support/`); read one existing service test first and copy its setup verbatim.

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import {
  consumeEmailToken,
  deleteExpiredEmailTokens,
  generateEmailCode,
  hashEmailCode,
  invalidateEmailTokens,
  issueEmailToken,
  MAX_SENDS_PER_WINDOW,
  RESEND_COOLDOWN_MS,
  RESET_TTL_MS,
  VERIFY_TTL_MS,
} from './email-token';

const T0 = 1_700_000_000_000;

describe('generateEmailCode', () => {
  it('is 8 characters from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateEmailCode()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it('does not repeat across 500 draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateEmailCode()));
    expect(seen.size).toBe(500);
  });
});

describe('issueEmailToken', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
  });

  it('stores only the hash of the code', async () => {
    const result = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'verify', email: 'ann@example.com', now: T0,
    });
    expect(result.ok).toBe(true);
    const code = (result as { ok: true; code: string }).code;
    const row = await prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: 'u1', purpose: 'verify' } },
    });
    expect(row.tokenHash).toBe(hashEmailCode(code));
    expect(row.tokenHash).not.toContain(code);
    expect(row.email).toBe('ann@example.com');
    expect(row.expiresAt).toBe(T0 + VERIFY_TTL_MS);
    expect(row.sendCount).toBe(1);
  });

  it('gives a reset token the shorter TTL', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0 });
    const row = await prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: 'u1', purpose: 'reset' } },
    });
    expect(row.expiresAt).toBe(T0 + RESET_TTL_MS);
  });

  it('refuses a resend inside the cooldown and says how long to wait', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 });
    const second = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 + 30_000,
    });
    expect(second).toEqual({ ok: false, reason: 'cooldown', retryAfterMs: 30_000 });
  });

  it('replaces the previous code once the cooldown has passed, invalidating it', async () => {
    const first = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0,
    });
    const firstCode = (first as { ok: true; code: string }).code;
    const second = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 + RESEND_COOLDOWN_MS,
    });
    expect(second.ok).toBe(true);
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1', purpose: 'verify', code: firstCode, now: T0 + RESEND_COOLDOWN_MS,
      })
    ).toBeNull();
  });

  it('caps sends within the rolling window', async () => {
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      const r = await issueEmailToken(prisma, {
        userId: 'u1', purpose: 'verify', email: 'a@b.co', now,
      });
      expect(r.ok).toBe(true);
      now += RESEND_COOLDOWN_MS;
    }
    const capped = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'verify', email: 'a@b.co', now,
    });
    expect(capped).toMatchObject({ ok: false, reason: 'send_cap' });
  });

  it('lets the window roll over', async () => {
    let now = T0;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now });
      now += RESEND_COOLDOWN_MS;
    }
    const after = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 + 60 * 60 * 1000 + 1,
    });
    expect(after.ok).toBe(true);
  });

  it('keeps verify and reset tokens independent', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 });
    const reset = await issueEmailToken(prisma, {
      userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0,
    });
    expect(reset.ok).toBe(true);
  });
});

describe('consumeEmailToken', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
  });

  const issue = async (now = T0, purpose: 'verify' | 'reset' = 'verify') => {
    const r = await issueEmailToken(prisma, { userId: 'u1', purpose, email: 'a@b.co', now });
    return (r as { ok: true; code: string }).code;
  };

  it('returns the address the code was sent to and deletes the row', async () => {
    const code = await issue();
    expect(await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 }))
      .toEqual({ email: 'a@b.co' });
    expect(await prisma.emailToken.count()).toBe(0);
  });

  it('is single-use', async () => {
    const code = await issue();
    await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 });
    expect(await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 }))
      .toBeNull();
  });

  it('rejects an expired code', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1', purpose: 'verify', code, now: T0 + VERIFY_TTL_MS + 1,
      })
    ).toBeNull();
  });

  it('rejects a wrong code WITHOUT destroying the valid one', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code: 'WRONGONE', now: T0 })
    ).toBeNull();
    expect(await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code, now: T0 }))
      .toEqual({ email: 'a@b.co' });
  });

  it('will not accept a verify code for a reset', async () => {
    const code = await issue(T0, 'verify');
    expect(await consumeEmailToken(prisma, { userId: 'u1', purpose: 'reset', code, now: T0 }))
      .toBeNull();
  });

  it('will not accept another account’s code', async () => {
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    const code = await issue();
    expect(await consumeEmailToken(prisma, { userId: 'u2', purpose: 'verify', code, now: T0 }))
      .toBeNull();
  });

  it('is case-insensitive about the typed code', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, {
        userId: 'u1', purpose: 'verify', code: code.toLowerCase(), now: T0,
      })
    ).toEqual({ email: 'a@b.co' });
  });

  it('tolerates spaces a user pasted around the code', async () => {
    const code = await issue();
    expect(
      await consumeEmailToken(prisma, { userId: 'u1', purpose: 'verify', code: ` ${code} `, now: T0 })
    ).toEqual({ email: 'a@b.co' });
  });
});

describe('invalidateEmailTokens', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'verify', email: 'a@b.co', now: T0 });
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0 });
  });

  it('drops every purpose when none is named', async () => {
    await invalidateEmailTokens(prisma, 'u1');
    expect(await prisma.emailToken.count()).toBe(0);
  });

  it('drops only the named purpose', async () => {
    await invalidateEmailTokens(prisma, 'u1', 'reset');
    expect(await prisma.emailToken.count()).toBe(1);
  });
});

describe('deleteExpiredEmailTokens', () => {
  it('removes only tokens past their expiry', async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'reset', email: 'a@b.co', now: T0 });
    await deleteExpiredEmailTokens(prisma, T0 + RESET_TTL_MS - 1);
    expect(await prisma.emailToken.count()).toBe(1);
    await deleteExpiredEmailTokens(prisma, T0 + RESET_TTL_MS + 1);
    expect(await prisma.emailToken.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run services/email-token.test.ts`
Expected: FAIL — cannot resolve `./email-token`.

- [ ] **Step 3: Write the service**

Create `app/server/services/email-token.ts`:

```ts
/**
 * Single-use codes for confirming an address and for resetting a password.
 *
 * Only the sha256 of a code is ever persisted — the same rule
 * `services/token.ts` applies to refresh tokens, for the same reason: a
 * database read must not yield a usable credential.
 *
 * There is at most ONE token per (user, purpose), which is the primary key. No
 * consumption path needs to look a token up BY its hash — confirming is
 * authenticated, and resetting submits the address — so a guessed code is
 * useless unless the guesser also names the right account. It also makes
 * "resend" an upsert that invalidates the code it replaces, instead of leaving a
 * trail of simultaneously-valid ones.
 *
 * `now` is injected on every function (defaulting to `Date.now`) so expiry,
 * cooldown and window-rollover tests need no fake timers — the same shape
 * `createLoginRateLimit` and `ReplaceStagingDeps.now` use.
 */
import * as crypto from 'crypto';

import { PrismaClient } from '@prisma/client';

export type EmailTokenPurpose = 'verify' | 'reset';

/**
 * 24h for a new address: the user may not be at their inbox, and the cost of a
 * long window is low because the token grants nothing except confirming an
 * address they already control. 1h for a reset, which DOES grant account access
 * and is always acted on immediately.
 */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export const RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * A ROLLING WINDOW, not a per-token-lifetime cap. A lifetime cap would strand a
 * user whose first five messages went to spam for the token's whole 24-hour TTL;
 * an hour-long window bounds abuse just as tightly and always recovers on its
 * own.
 */
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 5;

/**
 * Crockford base32 minus the letters that are misread when a human retypes a
 * code from their phone: I and L (look like 1), O (looks like 0), U (looks like
 * V). 8 characters over 25 symbols is ~37 bits, which is far past guessable
 * given a code is bound to one account, expires, and sits behind an IP limiter.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

export function generateEmailCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normalizes before hashing, so a user who types lowercase or pastes with
 * surrounding whitespace still matches. Normalizing here rather than at each
 * call site means the transformation cannot drift between issue and consume.
 */
export function hashEmailCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

function ttlFor(purpose: EmailTokenPurpose): number {
  return purpose === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS;
}

export type IssueResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'cooldown' | 'send_cap'; retryAfterMs: number };

export async function issueEmailToken(
  prisma: PrismaClient,
  args: { userId: string; purpose: EmailTokenPurpose; email: string; now?: number }
): Promise<IssueResult> {
  const now = args.now ?? Date.now();
  const key = { userId_purpose: { userId: args.userId, purpose: args.purpose } };
  const existing = await prisma.emailToken.findUnique({ where: key });

  // Window start is the row's `createdAt`, which is preserved across resends and
  // reset when the window rolls over — so `sendCount` always counts sends since
  // `createdAt`, and the two fields cannot disagree.
  const windowOpen = existing !== null && now - existing.createdAt < SEND_WINDOW_MS;

  if (existing !== null) {
    const sinceLastSend = now - existing.sentAt;
    if (sinceLastSend < RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterMs: RESEND_COOLDOWN_MS - sinceLastSend,
      };
    }
    if (windowOpen && existing.sendCount >= MAX_SENDS_PER_WINDOW) {
      return {
        ok: false,
        reason: 'send_cap',
        retryAfterMs: existing.createdAt + SEND_WINDOW_MS - now,
      };
    }
  }

  const code = generateEmailCode();
  const data = {
    tokenHash: hashEmailCode(code),
    email: args.email,
    expiresAt: now + ttlFor(args.purpose),
    sentAt: now,
  };
  await prisma.emailToken.upsert({
    where: key,
    create: {
      userId: args.userId,
      purpose: args.purpose,
      createdAt: now,
      sendCount: 1,
      ...data,
    },
    update: windowOpen
      ? { ...data, sendCount: { increment: 1 } }
      : { ...data, createdAt: now, sendCount: 1 },
  });
  return { ok: true, code };
}

/**
 * Validates and deletes in one step. A WRONG code is rejected without touching
 * the stored row — otherwise a stranger who knew an account's address could
 * destroy its outstanding token at will; brute force is bounded by the IP
 * limiter on the routes instead.
 */
export async function consumeEmailToken(
  prisma: PrismaClient,
  args: { userId: string; purpose: EmailTokenPurpose; code: string; now?: number }
): Promise<{ email: string } | null> {
  const now = args.now ?? Date.now();
  const row = await prisma.emailToken.findUnique({
    where: { userId_purpose: { userId: args.userId, purpose: args.purpose } },
  });
  if (row === null) return null;
  if (row.expiresAt <= now) {
    await prisma.emailToken.deleteMany({
      where: { userId: args.userId, purpose: args.purpose, tokenHash: row.tokenHash },
    });
    return null;
  }
  if (row.tokenHash !== hashEmailCode(args.code)) return null;

  // Guarded by the hash so that of two concurrent presentations of the same
  // code exactly one wins, the same one-winner property `consumeRefreshToken`
  // gets from DELETE ... RETURNING.
  const { count } = await prisma.emailToken.deleteMany({
    where: { userId: args.userId, purpose: args.purpose, tokenHash: row.tokenHash },
  });
  return count === 1 ? { email: row.email } : null;
}

export async function invalidateEmailTokens(
  prisma: PrismaClient,
  userId: string,
  purpose?: EmailTokenPurpose
): Promise<void> {
  await prisma.emailToken.deleteMany({
    where: { userId, ...(purpose === undefined ? {} : { purpose }) },
  });
}

export async function deleteExpiredEmailTokens(
  prisma: PrismaClient,
  now: number = Date.now()
): Promise<void> {
  await prisma.emailToken.deleteMany({ where: { expiresAt: { lte: now } } });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run services/email-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Sweep email tokens from the existing expiry sweep**

In `app/server/services/token.ts`, extend `deleteExpired`:

```ts
export async function deleteExpired(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lte: now } } });
  // Email tokens ride the same sweep rather than getting a timer of their own:
  // this already runs on every successful login, which is frequent enough for
  // rows whose only cost is a few bytes.
  await deleteExpiredEmailTokens(prisma, now);
}
```

Import `deleteExpiredEmailTokens` from `./email-token`. Add a case to `app/server/services/token.test.ts`:

```ts
it('also removes expired email tokens', async () => {
  await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
  await prisma.emailToken.create({
    data: {
      userId: 'u1', purpose: 'reset', tokenHash: 'h', email: 'a@b.co',
      expiresAt: Date.now() - 1, createdAt: Date.now() - 2, sentAt: Date.now() - 2,
    },
  });
  await deleteExpired(prisma);
  expect(await prisma.emailToken.count()).toBe(0);
});
```

- [ ] **Step 6: Run the tests and update the spec's cap wording**

Run: `cd app/server && npx vitest run services/token.test.ts services/email-token.test.ts`
Expected: PASS.

In `docs/superpowers/specs/2026-09-19-email-identity-design.md`, change "a **5-sends-per-token cap**" to "a **5-sends-per-rolling-hour cap**" and the matching phrase in the "Security and rate limits" section, so the spec and `SEND_WINDOW_MS` agree.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add app/server/services/email-token.ts app/server/services/email-token.test.ts app/server/services/token.ts app/server/services/token.test.ts docs/superpowers/specs/2026-09-19-email-identity-design.md
git commit -m "feat(server): add single-use email verification and reset tokens"
```

---
### Task 6: Address normalization and writes

**Files:**
- Create: `app/server/services/email.ts`
- Test: `app/server/services/email.test.ts`

**Interfaces:**
- Consumes: the `User` columns from Task 4.
- Produces:

```ts
export function normalizeEmail(raw: string): string;
export function isValidEmail(value: string): boolean;
export type EmailAccount = {
  id: string; username: string; email: string | null;
  emailVerifiedAt: number | null; isConfigAdmin: boolean;
};
export type SetEmailResult = { ok: true } | { ok: false; reason: 'invalid' | 'in_use' };
export function setUserEmail(prisma: PrismaClient, userId: string, raw: string): Promise<SetEmailResult>;
export function findUserByEmail(prisma: PrismaClient, raw: string): Promise<EmailAccount | null>;
export function markEmailVerified(prisma: PrismaClient, userId: string, now?: number): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/email.test.ts` (same Prisma harness as Task 5):

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import {
  findUserByEmail, isValidEmail, markEmailVerified, normalizeEmail, setUserEmail,
} from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ann.Reader@Example.COM ')).toBe('ann.reader@example.com');
  });
});

describe('isValidEmail', () => {
  it.each(['a@b.co', 'ann.reader+tag@sub.example.com', "o'brien@example.org"])(
    'accepts %s', (value) => expect(isValidEmail(value)).toBe(true)
  );

  it.each(['', 'ann', 'ann@', '@example.com', 'ann@example', 'a b@example.com', 'ann@@example.com'])(
    'rejects %s', (value) => expect(isValidEmail(value)).toBe(false)
  );

  it('rejects an address long enough to be abusive', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });
});

describe('setUserEmail', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
  });

  it('stores the address as entered and the key normalized', async () => {
    expect(await setUserEmail(prisma, 'u1', ' Ann@Example.com ')).toEqual({ ok: true });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(row.email).toBe('Ann@Example.com');
    expect(row.emailKey).toBe('ann@example.com');
  });

  it('leaves the new address unverified', async () => {
    await setUserEmail(prisma, 'u1', 'ann@example.com');
    await markEmailVerified(prisma, 'u1');
    await setUserEmail(prisma, 'u1', 'other@example.com');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(row.emailVerifiedAt).toBeNull();
  });

  it('rejects a malformed address', async () => {
    expect(await setUserEmail(prisma, 'u1', 'nope')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports a collision as an outcome rather than throwing', async () => {
    await setUserEmail(prisma, 'u1', 'shared@example.com');
    expect(await setUserEmail(prisma, 'u2', 'SHARED@example.com')).toEqual({
      ok: false, reason: 'in_use',
    });
  });

  it('lets a user re-set their own address', async () => {
    await setUserEmail(prisma, 'u1', 'ann@example.com');
    expect(await setUserEmail(prisma, 'u1', 'ann@example.com')).toEqual({ ok: true });
  });
});

describe('findUserByEmail', () => {
  beforeEach(async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await setUserEmail(prisma, 'u1', 'Ann@Example.com');
  });

  it('matches regardless of case or surrounding space', async () => {
    expect(await findUserByEmail(prisma, ' ANN@example.COM ')).toMatchObject({
      id: 'u1', username: 'ann', isConfigAdmin: false,
    });
  });

  it('returns null for an unknown address', async () => {
    expect(await findUserByEmail(prisma, 'nobody@example.com')).toBeNull();
  });

  it('returns null rather than scanning for a malformed value', async () => {
    expect(await findUserByEmail(prisma, 'not-an-address')).toBeNull();
  });
});

describe('markEmailVerified', () => {
  it('records when, not merely whether', async () => {
    await prisma.user.create({ data: { id: 'u1', username: 'ann' } });
    await setUserEmail(prisma, 'u1', 'ann@example.com');
    await markEmailVerified(prisma, 'u1', 1_700_000_000_000);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'u1' } });
    expect(row.emailVerifiedAt).toBe(1_700_000_000_000);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run services/email.test.ts`
Expected: FAIL — cannot resolve `./email`.

- [ ] **Step 3: Write the service**

Create `app/server/services/email.ts`:

```ts
/**
 * The one place an address is turned into the key everything else matches on.
 *
 * `email` keeps what the user typed (it is what appears in a From/To line and on
 * their settings page); `emailKey` is the normalized form and is what every
 * lookup and the unique constraint use. Both are written together here so they
 * can never disagree — a row with a key that does not match its address would be
 * invisible to login while still occupying the address.
 */
import { PrismaClient } from '@prisma/client';

import { isPrismaError } from './prisma-errors';

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately conservative and deliberately not RFC 5322: one `@`, no spaces, a
 * dot-bearing domain, and a length bound. This is a typo filter, not an
 * authority on address syntax — Cloudflare's own bounce handling is what
 * ultimately decides whether an address exists, and a `bad_address` send result
 * reports that back. The length cap keeps an absurd value out of the database
 * and out of a log line.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  return normalized.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(normalized);
}

export type EmailAccount = {
  id: string;
  username: string;
  email: string | null;
  emailVerifiedAt: number | null;
  isConfigAdmin: boolean;
};

export type SetEmailResult = { ok: true } | { ok: false; reason: 'invalid' | 'in_use' };

/**
 * Always clears `emailVerifiedAt`: a verified flag that outlived the address it
 * described would let a user redirect their notifications and their reset mail
 * to an unconfirmed inbox.
 *
 * `P2002` (the `emailKey` unique constraint) comes back as an outcome rather
 * than an exception, the same convention `createUser` uses for a duplicate
 * username — a second account wanting the same address is an ordinary thing for
 * a caller to render, not a fault.
 */
export async function setUserEmail(
  prisma: PrismaClient,
  userId: string,
  raw: string
): Promise<SetEmailResult> {
  if (!isValidEmail(raw)) return { ok: false, reason: 'invalid' };
  const email = raw.trim();
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { email, emailKey: normalizeEmail(email), emailVerifiedAt: null },
    });
    return { ok: true };
  } catch (e) {
    if (isPrismaError(e, 'P2002')) return { ok: false, reason: 'in_use' };
    throw e;
  }
}

/**
 * Returns `null` for anything that is not a plausible address INSTEAD of
 * querying: the only callers are login and forgot-password, both reachable
 * unauthenticated, and there is no reason to spend a query on a value that
 * cannot be stored in the first place.
 */
export async function findUserByEmail(
  prisma: PrismaClient,
  raw: string
): Promise<EmailAccount | null> {
  if (!isValidEmail(raw)) return null;
  return prisma.user.findUnique({
    where: { emailKey: normalizeEmail(raw) },
    select: { id: true, username: true, email: true, emailVerifiedAt: true, isConfigAdmin: true },
  });
}

export async function markEmailVerified(
  prisma: PrismaClient,
  userId: string,
  now: number = Date.now()
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run services/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add app/server/services/email.ts app/server/services/email.test.ts
git commit -m "feat(server): add email normalization and account address writes"
```

---

### Task 7: The admin row (and guard G3)

**Files:**
- Create: `app/server/services/admin-account.ts`
- Test: `app/server/services/admin-account.test.ts`
- Modify: `app/server/index.ts` (call `ensureAdminUser` before the startup scan)
- Modify: `app/server/graphql/schema/viewer/model.ts` (`users` listing excludes the admin row)
- Test: `app/server/graphql/schema/viewer/users.test.ts`

**Interfaces:**
- Consumes: `User.isConfigAdmin` from Task 4.
- Produces:

```ts
/** Prisma `where` fragment. The ONE place the exclusion is expressed. */
export const NOT_CONFIG_ADMIN: { isConfigAdmin: false };
export function ensureAdminUser(prisma: PrismaClient, username: string): Promise<string>; // returns the row id
export function isConfigAdminRow(prisma: PrismaClient, userId: string): Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests**

Create `app/server/services/admin-account.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { ensureAdminUser, isConfigAdminRow, NOT_CONFIG_ADMIN } from './admin-account';

describe('ensureAdminUser', () => {
  it('creates the row with no credentials of its own', async () => {
    const id = await ensureAdminUser(prisma, 'admin');
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.username).toBe('admin');
    expect(row.isConfigAdmin).toBe(true);
    // The add-on options are the only credential. A hash here would be a second
    // one, and a sync password would hand the admin OPDS/KOSync access it has
    // never had.
    expect(row.passwordHash).toBeNull();
    expect(row.syncPassword).toBeNull();
  });

  it('is idempotent across restarts', async () => {
    const first = await ensureAdminUser(prisma, 'admin');
    const second = await ensureAdminUser(prisma, 'admin');
    expect(second).toBe(first);
    expect(await prisma.user.count()).toBe(1);
  });

  it('renames the existing row when the options username changes', async () => {
    const id = await ensureAdminUser(prisma, 'admin');
    await prisma.user.update({ where: { id }, data: { email: 'a@b.co', emailKey: 'a@b.co' } });

    const after = await ensureAdminUser(prisma, 'librarian');

    expect(after).toBe(id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.username).toBe('librarian');
    // The whole point of renaming rather than re-creating.
    expect(row.email).toBe('a@b.co');
    expect(await prisma.user.count()).toBe(1);
  });

  it('leaves the row alone when the new username is taken', async () => {
    const id = await ensureAdminUser(prisma, 'admin');
    await prisma.user.create({ data: { id: 'u2', username: 'librarian' } });

    const after = await ensureAdminUser(prisma, 'librarian');

    expect(after).toBe(id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).username).toBe('admin');
  });

  it('adopts a legacy row that already bears the admin username, clearing its credentials', async () => {
    await prisma.user.create({
      data: { id: 'legacy', username: 'admin', passwordHash: 'argon2-hash', syncPassword: 'blue oak' },
    });

    const id = await ensureAdminUser(prisma, 'admin');

    expect(id).toBe('legacy');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: 'legacy' } });
    expect(row.isConfigAdmin).toBe(true);
    expect(row.passwordHash).toBeNull();
    expect(row.syncPassword).toBeNull();
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('isConfigAdminRow', () => {
  it('is true for the admin row and false for a reader', async () => {
    const adminId = await ensureAdminUser(prisma, 'admin');
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    expect(await isConfigAdminRow(prisma, adminId)).toBe(true);
    expect(await isConfigAdminRow(prisma, 'u2')).toBe(false);
  });

  it('is false for an unknown id', async () => {
    expect(await isConfigAdminRow(prisma, 'nope')).toBe(false);
  });
});

describe('NOT_CONFIG_ADMIN', () => {
  it('filters the admin row out of a listing', async () => {
    await ensureAdminUser(prisma, 'admin');
    await prisma.user.create({ data: { id: 'u2', username: 'bob' } });
    const rows = await prisma.user.findMany({ where: NOT_CONFIG_ADMIN });
    expect(rows.map((r) => r.username)).toEqual(['bob']);
  });
});
```

- [ ] **Step 2: Write the failing listing test**

Add to `app/server/graphql/schema/viewer/users.test.ts` (match the file's existing GraphQL execution helper):

```ts
it('excludes the config admin row from the user list', async () => {
  await ensureAdminUser(prisma, 'admin');
  await prisma.user.create({ data: { id: 'u2', username: 'bob' } });

  const result = await execute('{ viewer { users { username } } }', adminViewer);

  expect(result.data?.viewer.users.map((u: { username: string }) => u.username)).toEqual(['bob']);
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd app/server && npx vitest run services/admin-account.test.ts graphql/schema/viewer/users.test.ts`
Expected: FAIL — cannot resolve `./admin-account`; the listing test sees `['admin', 'bob']`.

- [ ] **Step 4: Write the service**

Create `app/server/services/admin-account.ts`:

```ts
/**
 * The config-based admin's `users` row.
 *
 * Bookplate's admin is defined by the add-on options (`config.username` /
 * `config.password`) and has historically had NO row at all — `/api/login`
 * compares against the options before it touches Prisma, and
 * `RefreshToken.userId` is nullable precisely for it. That left nowhere to hang
 * an email address, a verification state, or (next spec) notification
 * preferences, which is the only reason this row exists.
 *
 * THE ROW IS IDENTITY-ATTACHED DATA, NOT A PROMOTION. Three invariants keep it
 * that way, and each is load-bearing:
 *
 *  1. `passwordHash` and `syncPassword` stay NULL. The options remain the single
 *     credential; a hash here would be a second one that the options cannot
 *     rotate, and a sync password would grant OPDS/KOSync access the admin has
 *     never had (`authenticate` refuses a null sync password, which is the only
 *     thing denying it today).
 *  2. The admin's access token still carries no `sub`, so every path that
 *     reasons about ownership (`Viewer.library`, `Viewer.user`,
 *     `Viewer.syncPassword`, `loadOwner`) behaves exactly as before.
 *  3. Every user listing and every by-name mutation excludes the row, through
 *     `NOT_CONFIG_ADMIN` and `isConfigAdminRow` below. `user/mutation/delete.ts`
 *     and `user/mutation/reset-password.ts` used to get this for free — their doc
 *     comments argued that no `User` global ID could ever name the admin because
 *     it had no row. Creating the row invalidates that argument, so those
 *     mutations now need explicit guards.
 *
 * The exclusion is expressed ONCE, here, so that promoting the admin to an
 * ordinary user later (which needs a first-run onboarding flow this app does not
 * have — see the spec) is a change at one call site rather than an audit of every
 * query that touches users.
 */
import { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import { generateUserId } from '../utils/id';
import { isPrismaError } from './prisma-errors';

const log = logger('AdminAccount');

export const NOT_CONFIG_ADMIN = { isConfigAdmin: false } as const;

/**
 * Upserts the admin row and returns its id. Four cases, in this order:
 *
 *  1. A row already marked `isConfigAdmin` with the right username — nothing to do.
 *  2. A row already marked `isConfigAdmin` under a DIFFERENT username — the
 *     operator changed `username` in the options. RENAMED, not re-created, so the
 *     address and preferences follow the account. A rename blocked by a
 *     collision leaves the row untouched and warns; the alternative (creating a
 *     second admin row) would silently split the identity in two.
 *  3. No marked row, but an unmarked row already bears the admin username. This
 *     happens on legacy databases — `index.ts`'s startup scan already skips such
 *     a row ("a legacy DB row bearing its username must not materialize one").
 *     It is ADOPTED and its credentials are cleared, because from here on the
 *     options are the admin's only credential and leaving a usable hash on this
 *     row would create exactly the second credential invariant 1 forbids.
 *  4. Nothing at all — created.
 */
export async function ensureAdminUser(prisma: PrismaClient, username: string): Promise<string> {
  const marked = await prisma.user.findFirst({ where: { isConfigAdmin: true } });
  if (marked !== null) {
    if (marked.username === username) return marked.id;
    try {
      await prisma.user.update({ where: { id: marked.id }, data: { username } });
      log.info(`Admin row renamed from "${marked.username}" to "${username}"`);
    } catch (e) {
      if (!isPrismaError(e, 'P2002')) throw e;
      log.warn(
        `Cannot rename the admin row to "${username}" — another account already uses that ` +
          `username. Leaving it as "${marked.username}"; the admin still signs in with the ` +
          `add-on options credential.`
      );
    }
    return marked.id;
  }

  const legacy = await prisma.user.findUnique({ where: { username } });
  if (legacy !== null) {
    await prisma.user.update({
      where: { id: legacy.id },
      data: { isConfigAdmin: true, passwordHash: null, syncPassword: null },
    });
    log.warn(
      `Adopted the existing "${username}" row as the admin account and cleared its stored ` +
        `credentials — the add-on options are the admin's only credential.`
    );
    return legacy.id;
  }

  const created = await prisma.user.create({
    data: {
      id: generateUserId(),
      username,
      passwordHash: null,
      syncPassword: null,
      isConfigAdmin: true,
    },
  });
  log.info(`Created the admin account row for "${username}"`);
  return created.id;
}

/** Guard for every mutation that resolves its target by id or by name. */
export async function isConfigAdminRow(prisma: PrismaClient, userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { isConfigAdmin: true },
  });
  return row?.isConfigAdmin === true;
}
```

**Careful:** `createUser` in `services/user.ts` defaults `syncPassword` to `generateSyncPassword()`. `ensureAdminUser` must NOT go through it — it writes `prisma.user.create` directly so the null stays null.

- [ ] **Step 5: Exclude the row from the listing**

In `app/server/graphql/schema/viewer/model.ts`, add `where: NOT_CONFIG_ADMIN` to the `users` field's query and extend its doc comment:

```ts
      // `where: NOT_CONFIG_ADMIN` — the config admin now HAS a row (it needs one
      // to hold an email address; see `services/admin-account.ts`), but it is not
      // a reader: it owns no library and has no sync credentials. Listing it here
      // would show an empty phantom account in the admin panel. The predicate is
      // imported rather than inlined so the day the admin becomes an ordinary
      // user is a one-line change.
```

- [ ] **Step 6: Wire it into startup**

In `app/server/index.ts`, immediately before the startup-scan block (it must run before anything reads user rows):

```ts
  // Before the startup scan: the scan skips the admin's username explicitly, and
  // every email flow needs this row to exist.
  await ensureAdminUser(prisma, config.username);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run services/admin-account.test.ts graphql/schema/viewer/users.test.ts && npm test`
Expected: PASS. Watch for existing tests that count `prisma.user.count()` or assert a user list — the admin row is new and those counts change. Update them to expect the admin row, or filter with `NOT_CONFIG_ADMIN`; do not weaken an assertion to make it pass.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add app/server/services/admin-account.ts app/server/services/admin-account.test.ts app/server/index.ts app/server/graphql/schema/viewer/model.ts app/server/graphql/schema/viewer/users.test.ts
git commit -m "feat(server): give the config admin an identity row, excluded from listings"
```

---

### Task 8: Login by email, and guard G1

**Files:**
- Modify: `app/server/routes/ui.ts:561-608` (the `/api/login` handler)
- Test: `app/server/routes/ui.test.ts`

**Interfaces:**
- Consumes: `findUserByEmail` (Task 6), `ensureAdminUser`/`isConfigAdmin` (Task 7).
- Produces: no new exports. `/api/login`'s `username` field now accepts an address.

**G1 is the reason this task is not merely additive.** `/api/login` currently does: compare the config credential; then `findUnique({ where: { username } })`; then, if that row exists with no `passwordHash`, return **403 "password not set"**. The admin row has no `passwordHash`, so from Task 7 onward a *wrong admin password* falls into that branch and returns 403 instead of 401 — which both differs from every other failed login and confirms to an unauthenticated caller that the username exists.

- [ ] **Step 1: Write the failing tests**

Add to `app/server/routes/ui.test.ts`:

```ts
describe('login by email', () => {
  it('accepts a reader’s address in place of their username', async () => {
    await createReader('ann', 'reader-password', 'Ann@Example.com');

    const res = await request(app)
      .post('/api/login')
      .send({ username: 'ann@EXAMPLE.com', password: 'reader-password' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('accepts the admin’s own address', async () => {
    const adminId = await ensureAdminUser(prisma, 'admin');
    await prisma.user.update({
      where: { id: adminId },
      data: { email: 'boss@example.com', emailKey: 'boss@example.com' },
    });

    const res = await request(app)
      .post('/api/login')
      .send({ username: 'boss@example.com', password: 'admin-password' });

    expect(res.status).toBe(200);
    // Still the config admin: admin claims, and no sub.
    const claims = decode(res.body.accessToken);
    expect(claims.isAdmin).toBe(true);
    expect(claims.sub).toBeUndefined();
  });

  it('rejects an unknown address with the same 401 as an unknown username', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'nobody@example.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('leaves a value with no @ to the username path', async () => {
    await createReader('ann', 'reader-password');
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'ann', password: 'reader-password' });
    expect(res.status).toBe(200);
  });
});

describe('G1: the admin row must not change a failed admin login', () => {
  it('returns 401, not 403, for a wrong admin password', async () => {
    await ensureAdminUser(prisma, 'admin');

    const res = await request(app)
      .post('/api/login')
      .send({ username: 'admin', password: 'not-the-admin-password' });

    // 403 here would be "password not set" leaking that the admin row exists and
    // has no hash — see the branch this test guards in routes/ui.ts.
    expect(res.status).toBe(401);
  });

  it('still returns 403 for a reader whose password was never set', async () => {
    await prisma.user.create({ data: { id: 'u2', username: 'bob', passwordHash: null } });
    const res = await request(app).post('/api/login').send({ username: 'bob', password: 'x' });
    expect(res.status).toBe(403);
  });
});
```

Reuse the file's existing app/prisma setup and its admin password constant; `createReader` stands for whatever helper the file already has for making a user with a login password (add the third `email` parameter to it, or set the address with `setUserEmail` after).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run routes/ui.test.ts -t 'login by email'` then `-t 'G1'`
Expected: FAIL — the email login cases 401, and the G1 case returns 403.

- [ ] **Step 3: Resolve an identifier to a username**

In `routes/ui.ts`'s `/api/login` handler, immediately after the `typeof` guards and **before** the config-admin comparison:

```ts
      // The field is named `username` for compatibility — REST's contract is
      // unchanged — but it is an IDENTIFIER: an address when it contains an `@`,
      // a username otherwise. Resolving to a username here means everything
      // below, including the config-admin comparison and `validateUser`, keeps
      // working on usernames alone and no branch had to be duplicated.
      //
      // `@`-detection rather than "try both": a username cannot contain `@`
      // (`utils/username.ts`), so the two namespaces cannot collide and one
      // lookup is always enough.
      let loginName = username;
      if (username.includes('@')) {
        const byEmail = await findUserByEmail(prisma, username);
        if (byEmail === null) {
          log.warn('Login failed — no account for that email address');
          res.sendStatus(401);
          return;
        }
        loginName = byEmail.username;
      }
```

Then replace every later use of `username` in this handler with `loginName` — the config comparison, the `findUnique`, `validateUser`, `getMustChangePassword`, `issueTokens`, and the log lines. Leave the destructured `username` for the initial type guard only.

- [ ] **Step 4: Fix G1**

Change the no-password branch to skip the admin row:

```ts
      const loginUser = await prisma.user.findUnique({
        where: { username: loginName },
        select: { passwordHash: true, isConfigAdmin: true },
      });
      // `!isConfigAdmin` (G1): the admin row deliberately has NO passwordHash —
      // the add-on options are its only credential (`services/admin-account.ts`).
      // Without this, a wrong admin password would fall into this branch and
      // answer 403 "password not set" instead of the generic 401, which both
      // differs from every other failed login and confirms the username exists.
      if (loginUser !== null && !loginUser.passwordHash && !loginUser.isConfigAdmin) {
        log.warn(`Login failed for "${loginName}" — password not set`);
        res.sendStatus(403);
        return;
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd app/server && npx vitest run routes/ui.test.ts`
Expected: PASS, including every pre-existing login case.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add app/server/routes/ui.ts app/server/routes/ui.test.ts
git commit -m "feat(server): accept an email address at login, and keep a failed admin login a 401"
```

---
### Task 9: The `mustSetEmail` claim and its two gates

**Files:**
- Modify: `app/server/services/jwt.ts` (`AuthUser`, sign, verify)
- Modify: `app/server/middleware/auth.ts` (new `emailSetupGate`)
- Modify: `app/server/routes/ui.ts` (compute the flag at both `issueTokens` call sites and both refresh paths; mount the gate)
- Modify: `app/server/graphql/context.ts` (`Viewer.mustSetEmail`)
- Modify: `app/server/graphql/schema/builder.ts` (`emailSetupAllowed` scope)
- Test: `app/server/services/jwt.test.ts`, `app/server/middleware/auth.test.ts`, `app/server/routes/ui.test.ts`, `app/server/graphql/context.test.ts`

**Interfaces:**
- Consumes: `isMailConfigured` (Task 2), the `User.email` column (Task 4), `ensureAdminUser` (Task 7).
- Produces: `AuthUser.mustSetEmail: boolean`, `Viewer.mustSetEmail: boolean`, `emailSetupGate(secret: Buffer)`, auth scope `emailSetupAllowed`, and a helper:

```ts
// routes/ui.ts, module scope
export function computeMustSetEmail(
  prisma: PrismaClient, config: AppConfig, username: string
): Promise<boolean>;
```

- [ ] **Step 1: Write the failing tests**

`app/server/services/jwt.test.ts`:

```ts
it('round-trips mustSetEmail', () => {
  const token = signAccessToken(secret, {
    username: 'ann', isAdmin: false, mustChangePassword: false, mustSetEmail: true,
  });
  expect(verifyAccessToken(secret, token)?.mustSetEmail).toBe(true);
});

it('reads a token minted before the claim existed as false', () => {
  // Tokens issued by the previous version are still in browsers' localStorage for
  // up to ACCESS_TOKEN_TTL_SECONDS after an upgrade. They must keep verifying —
  // the server gates on database state anyway.
  const legacy = jwt.sign({ username: 'ann', isAdmin: false, mustChangePassword: false }, secret, {
    algorithm: 'HS256', expiresIn: 900,
  });
  expect(verifyAccessToken(secret, legacy)?.mustSetEmail).toBe(false);
});
```

`app/server/middleware/auth.test.ts`:

```ts
describe('emailSetupGate', () => {
  it('rejects an API request from a viewer who must set an email', async () => {
    const token = signAccessToken(secret, {
      username: 'ann', isAdmin: false, mustChangePassword: false, mustSetEmail: true,
    });
    const res = await request(app).get('/api/anything').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Email required');
  });

  it('allows a viewer who has one', async () => {
    const token = signAccessToken(secret, {
      username: 'ann', isAdmin: false, mustChangePassword: false, mustSetEmail: false,
    });
    const res = await request(app).get('/api/anything').set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(403);
  });

  it.each(['/api/login', '/api/auth/refresh', '/api/password/forgot', '/api/password/reset'])(
    'never gates %s',
    async (path) => {
      const token = signAccessToken(secret, {
        username: 'ann', isAdmin: false, mustChangePassword: false, mustSetEmail: true,
      });
      const res = await request(app).post(path).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).not.toBe(403);
    }
  );

  it('passes through a request with no token, leaving 401 to jwtAuth', async () => {
    const res = await request(app).get('/api/anything');
    expect(res.status).toBe(401);
  });
});
```

Mirror the existing `passwordChangeGate` describe block's app setup, and also add a case there asserting a viewer with **both** flags set is sent to the password gate first (a `403 "Password change required"`, not `"Email required"`).

`app/server/routes/ui.test.ts`:

```ts
describe('mustSetEmail claim', () => {
  it('is false when mail is unconfigured, even with no address', async () => {
    // config.mail is null in this suite's default AppConfig literal.
    await createReader('ann', 'pw');
    const res = await request(app).post('/api/login').send({ username: 'ann', password: 'pw' });
    expect(decode(res.body.accessToken).mustSetEmail).toBe(false);
  });

  it('is true when mail is configured and the account has no address', async () => {
    const app = buildApp({ mail: MAIL_CONFIG });
    await createReader('ann', 'pw');
    const res = await request(app).post('/api/login').send({ username: 'ann', password: 'pw' });
    expect(decode(res.body.accessToken).mustSetEmail).toBe(true);
  });

  it('is false once the account has an address', async () => {
    const app = buildApp({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'pw');
    await setUserEmail(prisma, id, 'ann@example.com');
    const res = await request(app).post('/api/login').send({ username: 'ann', password: 'pw' });
    expect(decode(res.body.accessToken).mustSetEmail).toBe(false);
  });

  it('applies to the admin too', async () => {
    const app = buildApp({ mail: MAIL_CONFIG });
    await ensureAdminUser(prisma, 'admin');
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'admin', password: ADMIN_PASSWORD });
    expect(decode(res.body.accessToken).mustSetEmail).toBe(true);
  });

  it('is recomputed on refresh, so configuring mail turns the gate on', async () => {
    const app = buildApp({ mail: MAIL_CONFIG });
    await createReader('ann', 'pw');
    const login = await request(app).post('/api/login').send({ username: 'ann', password: 'pw' });
    const refresh = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', login.headers['set-cookie']);
    expect(decode(refresh.body.accessToken).mustSetEmail).toBe(true);
  });
});
```

`buildApp({ mail })` stands for however this suite constructs its router — extend its options rather than adding a parallel builder.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app/server && npx vitest run services/jwt.test.ts middleware/auth.test.ts routes/ui.test.ts`
Expected: FAIL — `mustSetEmail` is not a property of `AuthUser`; `emailSetupGate` is not exported.

- [ ] **Step 3: Add the claim**

In `app/server/services/jwt.ts`, add to `AuthUser`:

```ts
  /**
   * An address is required but this account has none, AND mail is configured on
   * this install. Gates the API and the client exactly as `mustChangePassword`
   * does. Always false when mail is unconfigured — an install that cannot send
   * must not demand an address it can never verify.
   */
  mustSetEmail: boolean;
```

Add `mustSetEmail: user.mustSetEmail` to `signAccessToken`'s payload, and to `verifyAccessToken`'s return:

```ts
      // `=== true` rather than a typeof check in the contract guard above: a
      // token minted before this claim existed is still in browsers' storage for
      // up to ACCESS_TOKEN_TTL_SECONDS after an upgrade, and rejecting it would
      // log every signed-in user out for no gain — the server gates on database
      // state, not on the claim.
      mustSetEmail: payload.mustSetEmail === true,
```

- [ ] **Step 4: Write the gate**

In `app/server/middleware/auth.ts`, after `passwordChangeGate`:

```ts
/**
 * Blocks API access while an address is outstanding. A SIBLING of
 * `passwordChangeGate`, not a branch inside it: each gate answers one question,
 * and mounting them in order (password first) makes the precedence explicit
 * rather than an `if`/`else` reading.
 *
 * Same shape as its sibling for the same reasons — it runs before route-level
 * `jwtAuth`, so it verifies the token itself and lets a request WITHOUT a valid
 * one pass through for `jwtAuth` to reject. `/api/password/*` is exempt
 * alongside login and refresh: those routes are the unauthenticated reset flow
 * and must stay reachable regardless of any token a caller happens to present.
 */
export function emailSetupGate(secret: Buffer) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (
      !req.path.startsWith('/api/') ||
      req.path === '/api/login' ||
      req.path.startsWith('/api/auth/') ||
      req.path.startsWith('/api/password/')
    ) {
      next();
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      next();
      return;
    }
    const user = verifyAccessToken(secret, header.slice(7));
    if (user?.mustSetEmail) {
      res.status(403).json({ error: 'Email required' });
      return;
    }
    next();
  };
}
```

Also add `req.path.startsWith('/api/password/')` to `passwordChangeGate`'s exemption list, with the comment: `// The unauthenticated reset flow — a viewer with a pending forced change may legitimately be resetting their password by email.`

- [ ] **Step 5: Compute and mount**

In `routes/ui.ts`, at module scope:

```ts
/**
 * `mustSetEmail`'s single source of truth, DERIVED rather than stored: an
 * address is outstanding only when mail is configured, so flipping the add-on
 * options cannot leave a stale flag behind in the database. Looked up by
 * username because the config admin's token carries no `sub` and this must
 * answer for them too.
 */
export async function computeMustSetEmail(
  prisma: PrismaClient,
  config: AppConfig,
  username: string
): Promise<boolean> {
  if (!isMailConfigured(config)) return false;
  const row = await prisma.user.findUnique({ where: { username }, select: { email: true } });
  return row !== null && row.email === null;
}
```

Then pass it at all four sites — the admin branch and the user branch of `/api/login`, and the admin branch and the user branch of `/api/auth/refresh`:

```ts
        mustSetEmail: await computeMustSetEmail(prisma, config, loginName),
```

Note the admin branches previously hard-coded `mustChangePassword: false` and passed no `userId`; both stay exactly as they are. Only `mustSetEmail` is added.

Mount the gate right after the existing one:

```ts
  router.use(passwordChangeGate(jwtSecret));
  router.use(emailSetupGate(jwtSecret));
```

- [ ] **Step 6: Carry it into the GraphQL context and add the scope**

In `app/server/graphql/context.ts`, add `mustSetEmail: boolean` to the `Viewer` type and `mustSetEmail: user.mustSetEmail` to `viewerFromHeader`'s return.

In `app/server/graphql/schema/builder.ts`, add to `AuthScopes`:

```ts
    /**
     * A signed-in viewer, ignoring an outstanding email address. Only
     * `viewerSetEmail`, `viewerResendEmailVerification` and `viewerConfirmEmail`
     * may use this; everything else stays on `authenticated`, which refuses a
     * viewer who owes an address. The exemption is load-bearing for the same
     * reason `passwordChangeAllowed`'s is: these three mutations are the only
     * path out of the gate, so putting them on `authenticated` would strand the
     * viewer.
     */
    emailSetupAllowed: boolean;
```

and in the `scopeAuthOptions`/`authScopes` factory beside `passwordChangeAllowed`:

```ts
      emailSetupAllowed: context.viewer !== null && !context.viewer.mustChangePassword,
```

Then extend the existing `authenticated` scope so it also refuses a gated viewer — find where `authenticated` is defined (it currently asserts a viewer exists and has no pending password change) and add `&& !context.viewer.mustSetEmail`, with:

```ts
      // `authenticated` refuses BOTH outstanding credentials-setup states, so
      // every field in the schema is gated without restating either condition.
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd app/server && npm test`
Expected: PASS. Existing tests constructing an `AuthUser` literal will fail to typecheck until `mustSetEmail` is added — add `mustSetEmail: false` to each; that is the correct value for every pre-existing case.

- [ ] **Step 8: Regenerate the schema, lint, commit**

```bash
cd app/server && npm run graphql:schema && cd ../.. && npm run lint
git add app/server/services/jwt.ts app/server/services/jwt.test.ts app/server/middleware/auth.ts app/server/middleware/auth.test.ts app/server/routes/ui.ts app/server/routes/ui.test.ts app/server/graphql/context.ts app/server/graphql/context.test.ts app/server/graphql/schema/builder.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(server): gate the API on an outstanding email address"
```

---

### Task 10: Verification mutations

**Files:**
- Create: `app/server/graphql/schema/email-in-use-error/{model.ts,index.ts}`
- Create: `app/server/graphql/schema/email-not-configured-error/{model.ts,index.ts}`
- Create: `app/server/graphql/schema/viewer/mutation/set-email.ts` + `.test.ts`
- Create: `app/server/graphql/schema/viewer/mutation/resend-email-verification.ts` + `.test.ts`
- Create: `app/server/graphql/schema/viewer/mutation/confirm-email.ts` + `.test.ts`
- Modify: `app/server/graphql/schema/viewer/model.ts` (`email`, `emailVerifiedAt`)
- Modify: `app/server/graphql/schema/index.ts` (register the new modules)
- Modify: `app/server/graphql/context.ts` (`mailer` on `Context`/`ContextDeps`)
- Modify: `app/server/server.ts`, `app/server/index.ts` (construct and pass the mailer)

**Interfaces:**
- Consumes: `Mailer`/`createMailer`/`isMailConfigured` (Task 2), templates (Task 3), `issueEmailToken`/`consumeEmailToken`/`invalidateEmailTokens` (Task 5), `setUserEmail`/`markEmailVerified` (Task 6).
- Produces GraphQL: `Viewer.email: String` (nullable), `Viewer.emailVerifiedAt: DateTime` (nullable), mutations `viewerSetEmail(input: { email: String! }): ViewerSetEmailResult`, `viewerResendEmailVerification: ViewerResendEmailVerificationResult`, `viewerConfirmEmail(input: { code: String! }): ViewerConfirmEmailResult`. Each result union contains its payload plus `InvalidInputError`, `EmailNotConfiguredError`, and — for `viewerSetEmail` — `EmailInUseError`.
- Produces TypeScript: `resolveViewerUserId(context): Promise<string | null>` exported from `viewer/mutation/resolve-user-id.ts`.

- [ ] **Step 1: Write the failing tests**

Create the three test files. `set-email.test.ts`:

```ts
describe('viewerSetEmail', () => {
  it('stores the address, leaves it unverified, and sends a code', async () => {
    const { execute, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');

    const result = await execute(SET_EMAIL, { email: 'Ann@Example.com' }, viewerFor('ann', id));

    expect(result.data?.viewerSetEmail.__typename).toBe('ViewerSetEmailPayload');
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.email).toBe('Ann@Example.com');
    expect(row.emailVerifiedAt).toBeNull();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe('Ann@Example.com');
    expect(mailer.sent[0].subject).toContain('Confirm');
  });

  it('sends a code that confirmEmail accepts', async () => {
    const { execute, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    await execute(SET_EMAIL, { email: 'ann@example.com' }, viewerFor('ann', id));

    const code = /\b[0-9A-HJKMNP-TV-Z]{8}\b/.exec(mailer.sent[0].text)![0];
    const result = await execute(CONFIRM_EMAIL, { code }, viewerFor('ann', id));

    expect(result.data?.viewerConfirmEmail.__typename).toBe('ViewerConfirmEmailPayload');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).emailVerifiedAt).not.toBeNull();
  });

  it('returns EmailInUseError when another account holds the address', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const other = await createReader('bob');
    await setUserEmail(prisma, other, 'shared@example.com');
    const id = await createReader('ann');

    const result = await execute(SET_EMAIL, { email: 'SHARED@example.com' }, viewerFor('ann', id));

    expect(result.data?.viewerSetEmail.__typename).toBe('EmailInUseError');
  });

  it('returns InvalidInputError for a malformed address', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    const result = await execute(SET_EMAIL, { email: 'nope' }, viewerFor('ann', id));
    expect(result.data?.viewerSetEmail.__typename).toBe('InvalidInputError');
  });

  it('returns EmailNotConfiguredError when the install cannot send', async () => {
    const { execute } = build({ mail: null });
    const id = await createReader('ann');
    const result = await execute(SET_EMAIL, { email: 'ann@example.com' }, viewerFor('ann', id));
    expect(result.data?.viewerSetEmail.__typename).toBe('EmailNotConfiguredError');
  });

  it('succeeds even when the send fails, so the address is not lost', async () => {
    const { execute, mailer } = build({ mail: MAIL_CONFIG });
    mailer.nextResult = { ok: false, reason: 'transient' };
    const id = await createReader('ann');

    const result = await execute(SET_EMAIL, { email: 'ann@example.com' }, viewerFor('ann', id));

    expect(result.data?.viewerSetEmail.__typename).toBe('ViewerSetEmailPayload');
    expect(result.data?.viewerSetEmail.delivered).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).email).toBe('ann@example.com');
  });

  it('works for the config admin, whose viewer has no userId', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const adminId = await ensureAdminUser(prisma, 'admin');

    const result = await execute(SET_EMAIL, { email: 'boss@example.com' }, adminViewer('admin'));

    expect(result.data?.viewerSetEmail.__typename).toBe('ViewerSetEmailPayload');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).email)
      .toBe('boss@example.com');
  });

  it('is reachable by a viewer who is gated on setting an address', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    const result = await execute(
      SET_EMAIL, { email: 'ann@example.com' }, { ...viewerFor('ann', id), mustSetEmail: true }
    );
    expect(result.errors).toBeUndefined();
  });

  it('is NOT reachable by a viewer who owes a password change', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    const result = await execute(
      SET_EMAIL, { email: 'ann@example.com' }, { ...viewerFor('ann', id), mustChangePassword: true }
    );
    expect(result.errors?.[0].message).toMatch(/not authorized/i);
  });

  it('invalidates an outstanding reset token when the address changes', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    await setUserEmail(prisma, id, 'old@example.com');
    await issueEmailToken(prisma, { userId: id, purpose: 'reset', email: 'old@example.com' });

    await execute(SET_EMAIL, { email: 'new@example.com' }, viewerFor('ann', id));

    expect(await prisma.emailToken.count({ where: { userId: id, purpose: 'reset' } })).toBe(0);
  });
});
```

`resend-email-verification.test.ts`:

```ts
describe('viewerResendEmailVerification', () => {
  it('sends a fresh code', async () => {
    const { execute, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    await setUserEmail(prisma, id, 'ann@example.com');

    const result = await execute(RESEND, {}, viewerFor('ann', id));

    expect(result.data?.viewerResendEmailVerification.__typename)
      .toBe('ViewerResendEmailVerificationPayload');
    expect(mailer.sent).toHaveLength(1);
  });

  it('reports the cooldown rather than sending twice', async () => {
    const { execute, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    await setUserEmail(prisma, id, 'ann@example.com');
    await execute(RESEND, {}, viewerFor('ann', id));

    const second = await execute(RESEND, {}, viewerFor('ann', id));

    expect(second.data?.viewerResendEmailVerification.__typename).toBe('InvalidInputError');
    expect(mailer.sent).toHaveLength(1);
  });

  it('refuses when the account has no address to send to', async () => {
    const { execute } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    const result = await execute(RESEND, {}, viewerFor('ann', id));
    expect(result.data?.viewerResendEmailVerification.__typename).toBe('InvalidInputError');
  });

  it('refuses for an already-verified address', async () => {
    const { execute, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    await setUserEmail(prisma, id, 'ann@example.com');
    await markEmailVerified(prisma, id);
    const result = await execute(RESEND, {}, viewerFor('ann', id));
    expect(result.data?.viewerResendEmailVerification.__typename).toBe('InvalidInputError');
    expect(mailer.sent).toHaveLength(0);
  });
});
```

`confirm-email.test.ts`:

```ts
describe('viewerConfirmEmail', () => {
  const setup = async () => {
    const built = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann');
    await setUserEmail(prisma, id, 'ann@example.com');
    const issued = await issueEmailToken(prisma, {
      userId: id, purpose: 'verify', email: 'ann@example.com',
    });
    return { ...built, id, code: (issued as { ok: true; code: string }).code };
  };

  it('marks the address verified', async () => {
    const { execute, id, code } = await setup();
    const result = await execute(CONFIRM_EMAIL, { code }, viewerFor('ann', id));
    expect(result.data?.viewerConfirmEmail.__typename).toBe('ViewerConfirmEmailPayload');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).emailVerifiedAt).not.toBeNull();
  });

  it('rejects a wrong code', async () => {
    const { execute, id } = await setup();
    const result = await execute(CONFIRM_EMAIL, { code: 'WRONGONE' }, viewerFor('ann', id));
    expect(result.data?.viewerConfirmEmail.__typename).toBe('InvalidInputError');
  });

  it('rejects a code once used', async () => {
    const { execute, id, code } = await setup();
    await execute(CONFIRM_EMAIL, { code }, viewerFor('ann', id));
    const second = await execute(CONFIRM_EMAIL, { code }, viewerFor('ann', id));
    expect(second.data?.viewerConfirmEmail.__typename).toBe('InvalidInputError');
  });

  it('rejects a code issued for an address the account no longer has', async () => {
    const { execute, id, code } = await setup();
    await prisma.user.update({
      where: { id },
      data: { email: 'moved@example.com', emailKey: 'moved@example.com' },
    });
    const result = await execute(CONFIRM_EMAIL, { code }, viewerFor('ann', id));
    expect(result.data?.viewerConfirmEmail.__typename).toBe('InvalidInputError');
  });
});
```

Add to `app/server/graphql/schema/viewer/user.test.ts`:

```ts
it('exposes the address on Viewer itself, so the admin can read their own', async () => {
  const adminId = await ensureAdminUser(prisma, 'admin');
  await setUserEmail(prisma, adminId, 'boss@example.com');

  const result = await execute('{ viewer { email emailVerifiedAt user { id } } }', adminViewer('admin'));

  expect(result.data?.viewer.email).toBe('boss@example.com');
  expect(result.data?.viewer.emailVerifiedAt).toBeNull();
  // Viewer.user stays null for the admin — which is exactly why email cannot
  // live behind it.
  expect(result.data?.viewer.user).toBeNull();
});
```

`build({ mail })` must return a fake mailer: `{ sent: MailMessage[]; nextResult?: SendResult; send(m) { this.sent.push(m); return this.nextResult ?? { ok: true }; } }`, injected as `Context.mailer`. Add it to the existing GraphQL test helper in `graphql/test-util.ts` rather than creating a second harness.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd app/server && npx vitest run graphql/schema/viewer`
Expected: FAIL — unknown mutation fields.

- [ ] **Step 3: Put the mailer in the context**

`graphql/context.ts`: add `mailer: Mailer | null;` to both `Context` and `ContextDeps`, pass it through `createContext`, and document it:

```ts
  /**
   * `null` when the install has no mail configuration. Constructed once in
   * `index.ts` and shared with `routes/ui.ts`, never one instance per request —
   * the Cloudflare driver latches its misconfiguration warning per instance, so a
   * per-request mailer would log that line on every send.
   */
  mailer: Mailer | null;
```

In `index.ts`, `const mailer = createMailer(config.mail);` beside the other singletons, and pass it to both `createServer`/`createUiRouter` and the GraphQL context deps. Thread it through `server.ts`'s options type.

- [ ] **Step 4: Write the two error types**

`email-in-use-error/model.ts` (mirror `username-already-exists-error/model.ts` exactly — same file shape, same `UserError` interface implementation):

```ts
export type EmailInUseErrorShape = {
  readonly __typename: 'EmailInUseError';
  readonly message: string;
};

export const emailInUseError = (): EmailInUseErrorShape => ({
  __typename: 'EmailInUseError',
  message: 'That email address is already in use by another account.',
});

export const model = builder
  .objectRef<EmailInUseErrorShape>('EmailInUseError')
  .implement({ interfaces: [userError], fields: () => ({}) });
```

`email-not-configured-error/model.ts`, same file shape:

```ts
/**
 * A distinct type rather than an `InvalidInputError`: nothing the user typed is
 * wrong, and a client should render this as the administrator's task rather than
 * as a field error. It is reachable mainly when an operator removes the mail
 * credentials while a client that already loaded the page is still open.
 */
export type EmailNotConfiguredErrorShape = {
  readonly __typename: 'EmailNotConfiguredError';
  readonly message: string;
};

export const emailNotConfiguredError = (): EmailNotConfiguredErrorShape => ({
  __typename: 'EmailNotConfiguredError',
  message: 'Email is not configured on this server. Ask the administrator to set it up.',
});

export const model = builder
  .objectRef<EmailNotConfiguredErrorShape>('EmailNotConfiguredError')
  .implement({ interfaces: [userError], fields: () => ({}) });
```

- [ ] **Step 5: Write the shared viewer-row resolver**

Create `app/server/graphql/schema/viewer/mutation/resolve-user-id.ts`:

```ts
/**
 * The acting account's row id.
 *
 * `viewer.userId` is null for the config-based admin — its access token
 * deliberately carries no `sub`, so that every ownership path keeps behaving as
 * it did before the admin had a row at all. The admin DOES now have a row (it is
 * where its address lives), reachable only by username. Every email mutation
 * needs a row id to key `EmailToken`, so all three resolve it through here
 * rather than each re-deriving the fallback.
 */
import type { Context } from '../../../context';
import { requireViewer } from '../../../context';

export async function resolveViewerUserId(context: Context): Promise<string | null> {
  const viewer = requireViewer(context);
  if (viewer.userId !== null) return viewer.userId;
  const row = await context.prisma.user.findUnique({
    where: { username: viewer.username },
    select: { id: true },
  });
  return row?.id ?? null;
}
```

- [ ] **Step 6: Write `viewerSetEmail`**

Create `app/server/graphql/schema/viewer/mutation/set-email.ts`, following `user/mutation/change-password.ts`'s file shape (input type, payload objectRef, result union, `builder.mutationField`). The resolver body:

```ts
    resolve: async (_root, { input }, context) => {
      if (!isMailConfigured(context.config)) return emailNotConfiguredError();
      const userId = await resolveViewerUserId(context);
      if (userId === null) return invalidInputError([{ path: [], message: 'No such account' }]);

      const outcome = await setUserEmail(context.prisma, userId, input.email);
      if (!outcome.ok) {
        return outcome.reason === 'in_use'
          ? emailInUseError()
          : invalidInputError([{ path: ['email'], message: 'Enter a valid email address' }]);
      }

      // Every outstanding token, both purposes: a verify code for the old
      // address proves nothing about the new one, and a reset code sent to an
      // address the account no longer has must not remain spendable.
      await invalidateEmailTokens(context.prisma, userId);

      const issued = await issueEmailToken(context.prisma, {
        userId,
        purpose: 'verify',
        email: input.email.trim(),
      });
      // The address is already saved. A send failure is reported through
      // `delivered: false` rather than as an error result, because failing the
      // mutation would tell the client nothing was stored — and the resend
      // button is how the user retries.
      const delivered =
        issued.ok &&
        (
          await context.mailer!.send(
            verificationMessage({
              to: input.email.trim(),
              code: issued.code,
              libraryName: context.config.libraryName,
              publicUrl: context.config.publicUrl ?? null,
            })
          )
        ).ok;

      return { __typename: 'ViewerSetEmailPayload' as const, email: input.email.trim(), delivered };
    },
```

Scope: `authScopes: { emailSetupAllowed: true }`. Payload fields: `email: t.exposeString('email')`, `delivered: t.exposeBoolean('delivered')` with:

```ts
    /**
     * Whether the verification email actually went out. False means the address
     * was saved but the message did not send (bad credentials, a bounce, a
     * throttle) — the client shows a "resend" affordance rather than an error,
     * because nothing the user did was wrong.
     */
```

- [ ] **Step 7: Write the other two mutations**

`resend-email-verification.ts` — no input; scope `emailSetupAllowed: true`:

```ts
    resolve: async (_root, _args, context) => {
      if (!isMailConfigured(context.config)) return emailNotConfiguredError();
      const userId = await resolveViewerUserId(context);
      if (userId === null) return invalidInputError([{ path: [], message: 'No such account' }]);

      const row = await context.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true },
      });
      if (row.email === null) {
        return invalidInputError([{ path: [], message: 'Add an email address first' }]);
      }
      if (row.emailVerifiedAt !== null) {
        return invalidInputError([{ path: [], message: 'That address is already confirmed' }]);
      }

      const issued = await issueEmailToken(context.prisma, {
        userId, purpose: 'verify', email: row.email,
      });
      if (!issued.ok) {
        const seconds = Math.ceil(issued.retryAfterMs / 1000);
        return invalidInputError([
          { path: [], message: `Too many attempts — try again in ${seconds} seconds` },
        ]);
      }
      const result = await context.mailer!.send(
        verificationMessage({
          to: row.email,
          code: issued.code,
          libraryName: context.config.libraryName,
          publicUrl: context.config.publicUrl ?? null,
        })
      );
      return { __typename: 'ViewerResendEmailVerificationPayload' as const, delivered: result.ok };
    },
```

`confirm-email.ts` — input `{ code: String! }`, scope `emailSetupAllowed: true`:

```ts
    resolve: async (_root, { input }, context) => {
      const userId = await resolveViewerUserId(context);
      if (userId === null) return invalidInputError([{ path: [], message: 'No such account' }]);

      const consumed = await consumeEmailToken(context.prisma, {
        userId, purpose: 'verify', code: input.code,
      });
      // One message for every failure — wrong, expired, already used. The user
      // takes the same action in all three cases (resend), and distinguishing
      // them tells a guesser which half of the guess was right.
      if (consumed === null) {
        return invalidInputError([
          { path: ['code'], message: 'That code is not valid or has expired' },
        ]);
      }
      const row = await context.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      });
      // The address moved after the code was issued: confirming would mark an
      // address verified that this code never proved.
      if (row.email === null || normalizeEmail(row.email) !== normalizeEmail(consumed.email)) {
        return invalidInputError([
          { path: ['code'], message: 'That code was sent to a different address' },
        ]);
      }
      await markEmailVerified(context.prisma, userId);
      return { __typename: 'ViewerConfirmEmailPayload' as const, email: row.email };
    },
```

No `isMailConfigured` check on confirm: a code already in a user's hands must stay redeemable even if the operator has since removed the credentials.

- [ ] **Step 8: Expose the address on `Viewer`**

In `viewer/model.ts`, beside `mustChangePassword`:

```ts
    /**
     * ON `Viewer`, NOT behind `Viewer.user` — deliberately. `Viewer.user` resolves
     * through `v.userId`, which is null for the config-based admin, so an address
     * hung off it would be unreadable by the one account that cannot recover its
     * password any other way. Resolved by username fallback, the same way
     * `resolveViewerUserId` does for the mutations.
     */
    email: t.field({
      type: 'String',
      nullable: true,
      resolve: async (v, _args, context) => {
        const row = await context.prisma.user.findUnique({
          where: { username: v.username },
          select: { email: true },
        });
        return row?.email ?? null;
      },
    }),

    emailVerifiedAt: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: async (v, _args, context) => {
        const row = await context.prisma.user.findUnique({
          where: { username: v.username },
          select: { emailVerifiedAt: true },
        });
        return row?.emailVerifiedAt === undefined || row.emailVerifiedAt === null
          ? null
          : new Date(row.emailVerifiedAt);
      },
    }),

    mustSetEmail: t.exposeBoolean('mustSetEmail'),
```

- [ ] **Step 9: Register, regenerate, run**

Add the five new modules to `graphql/schema/index.ts` in its existing alphabetical/grouped order.

Run:
```bash
cd app/server && npm run graphql:schema && npm test
```
Expected: PASS.

- [ ] **Step 10: Check the cost budget**

Run: `cd app/server && npm run test:cost`
Expected: PASS. `Viewer.email` and `Viewer.emailVerifiedAt` each add a field to the viewer bootstrap; if a budget test fails, read `docs/`-recorded budgets before changing a limit — prefer collapsing the two resolvers into one `viewer { email emailVerifiedAt }` lookup over raising a ceiling.

- [ ] **Step 11: Lint and commit**

```bash
npm run lint
git add app/server/graphql app/server/index.ts app/server/server.ts
git commit -m "feat(server): add email verification mutations and expose the viewer's address"
```

---
### Task 11: Guards G2, G3 and G5 — the admin row is unaddressable

**Files:**
- Modify: `app/server/graphql/schema/user/mutation/delete.ts` (guard + rewrite the doc comment)
- Modify: `app/server/graphql/schema/user/mutation/reset-password.ts` (guard + rewrite the doc comment)
- Modify: `app/server/graphql/schema/viewer/mutation/regenerate-sync-password.ts` (guard)
- Modify: `app/server/graphql/schema/viewer/model.ts` (note on the three `userId === null` comments)
- Test: the three mutations' existing `.test.ts` files

**Interfaces:**
- Consumes: `isConfigAdminRow` (Task 7).
- Produces: no new exports.

**Why this task exists.** `user/mutation/delete.ts` and `user/mutation/reset-password.ts` both carry doc comments arguing that REST's admin-target `403` needs no equivalent here *because* "the config admin has no `User` row and so no `User` global ID could ever name it". Task 7 creates that row and invalidates the argument. `userResetPassword` is the sharp one: it would write a real `passwordHash` onto the admin row, and `validateUser` authenticates any row that has one — producing a second credential for the admin account that the add-on options neither govern nor can rotate.

- [ ] **Step 1: Write the failing tests**

In `user/mutation/delete.test.ts`:

```ts
it('refuses to delete the config admin row', async () => {
  const adminId = await ensureAdminUser(prisma, 'admin');

  const result = await execute(DELETE_USER, { userId: globalUserId(adminId) }, adminViewer);

  // Indistinguishable from a nonexistent row: the admin row is UNADDRESSABLE,
  // not merely protected.
  expect(result.data?.userDelete).toBeNull();
  expect(await prisma.user.findUnique({ where: { id: adminId } })).not.toBeNull();
});
```

In `user/mutation/reset-password.test.ts`:

```ts
it('refuses to reset the config admin password, and writes no hash', async () => {
  const adminId = await ensureAdminUser(prisma, 'admin');

  const result = await execute(RESET_PASSWORD, { userId: globalUserId(adminId) }, adminViewer);

  expect(result.data?.userResetPassword).toBeNull();
  // The load-bearing assertion: a hash here would be a second credential for the
  // admin account that the add-on options cannot rotate.
  expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).passwordHash).toBeNull();
});
```

In `viewer/mutation/regenerate-sync-password.test.ts`:

```ts
it('refuses for the config admin, which has no sync credentials', async () => {
  const adminId = await ensureAdminUser(prisma, 'admin');

  const result = await execute(REGENERATE, {}, adminViewer('admin'));

  expect(result.data?.viewerRegenerateSyncPassword.__typename).not.toBe(
    'ViewerRegenerateSyncPasswordPayload'
  );
  expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).syncPassword).toBeNull();
});
```

Match each file's existing execution helper, global-ID builder and result-shape assertions; if a file asserts on a specific error type for "no such user", assert the same one here.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app/server && npx vitest run graphql/schema/user/mutation graphql/schema/viewer/mutation`
Expected: FAIL — the admin row is deleted, a hash is written, a sync password is generated.

- [ ] **Step 3: Guard `userDelete`**

At the top of the resolver, right after the owner is resolved and before `deleteUser`:

```ts
      // G2: the config admin's row is not a deletable account. Before this row
      // existed, this mutation got the guarantee for free — see the doc comment
      // above. Returning the ordinary "no such user" result rather than a distinct
      // error keeps the row unaddressable instead of merely protected.
      if (await isConfigAdminRow(context.prisma, owner.userId)) return null;
```

Replace the doc comment's "Self-deletion / last admin" and "REST's one target-specific 403" paragraphs with:

```
 * Self-deletion / "last admin": the config admin DOES have a `users` row as of
 * the email-identity work — it is where its address and (next spec) notification
 * preferences live — but that row is identity-attached data, not an account this
 * mutation may touch. The guard in the resolver refuses it explicitly, restoring
 * what REST's target-specific 403 did and what this comment previously argued was
 * unnecessary because no `User` global ID could name the admin. That argument no
 * longer holds: the row exists and has an id. See `services/admin-account.ts`.
 *
 * The guard returns the ordinary "no such user" `null` rather than a distinct
 * error, so the admin row stays indistinguishable from a nonexistent one — the
 * same shape an attacker-crafted global ID gets.
```

- [ ] **Step 4: Guard `userResetPassword`**

```ts
      // G2: refusing is not cosmetic here. `resetPassword` writes a real argon2
      // hash, and `validateUser` authenticates ANY row that has one — so allowing
      // this would mint a second admin credential that the add-on options cannot
      // rotate or revoke. The admin's password is the options value, full stop.
      if (await isConfigAdminRow(context.prisma, owner.userId)) return null;
```

Replace the "REST's target-specific 403 ... has no equivalent branch here" paragraph with a statement that the branch now exists, naming the second-credential consequence above.

- [ ] **Step 5: Guard `viewerRegenerateSyncPassword`**

This one resolves its target as `context.viewer!.username`, so guard by name:

```ts
      // G3: the admin has no sync credentials and must not acquire any —
      // `authenticate` refusing a null `syncPassword` is the only thing keeping
      // the admin out of OPDS and KOSync. Before the admin had a row,
      // `changeSyncPassword` simply found nothing.
      if (context.viewer!.isAdmin) {
        return invalidInputError([
          { path: [], message: 'The administrator account has no sync password.' },
        ]);
      }
```

Use whichever error member that mutation's result union already has for a refusal; if it has only a payload, add `InvalidInputError` to the union and regenerate the schema.

- [ ] **Step 6: Annotate `viewer/model.ts` (G5)**

The three "config-based admin, which has no row in the users table" comments on `Viewer.library`, `Viewer.user` and `Viewer.syncPassword` are still *functionally* right — `userId` is null for the admin, so all three still return null — but the parenthetical is now wrong. Change each to read "the config-based admin, whose token carries no `sub`" and add once, on `Viewer.user`:

```ts
     * The admin now HAS a row (`services/admin-account.ts` — it holds its email
     * address), but its token deliberately still carries no `sub`, so this field
     * stays null for it and every ownership path is unchanged. That is exactly
     * why `Viewer.email` is a field on `Viewer` and not reached through here.
```

- [ ] **Step 7: Invalidate reset tokens on any password change**

The spec requires outstanding tokens to die on a password change, not only on an
address change. `routes/password.ts` does this for its own flow (Task 12), but the
two GraphQL paths that also change a password do not. Write the tests first.

In `user/mutation/change-password.test.ts`:

```ts
it('invalidates an outstanding reset token', async () => {
  const id = await createReader('ann', 'old-password');
  await setUserEmail(prisma, id, 'ann@example.com');
  await issueEmailToken(prisma, { userId: id, purpose: 'reset', email: 'ann@example.com' });

  await execute(
    CHANGE_PASSWORD,
    { currentPassword: 'old-password', newPassword: 'new-password-x' },
    viewerFor('ann', id)
  );

  // A code minted while the old password was live must not stay spendable after
  // the user has chosen a new one — the same reasoning behind revoking every
  // refresh token, which this mutation already does.
  expect(await prisma.emailToken.count({ where: { userId: id, purpose: 'reset' } })).toBe(0);
});
```

In `user/mutation/reset-password.test.ts`, the same assertion for an admin-driven
reset of a *reader* (not the admin row, which Step 4 refuses outright).

Then in both resolvers, immediately after the existing `revokeAllForUsername`
call:

```ts
      await invalidateEmailTokens(context.prisma, owner.userId, 'reset');
```

In `change-password.ts` use whichever id that resolver already holds for the
acting row, or `resolveViewerUserId(context)` if it holds only a username.

- [ ] **Step 8: Run everything**

Run: `cd app/server && npm test`
Expected: PASS.

- [ ] **Step 9: Regenerate the schema if the union changed, lint, commit**

```bash
cd app/server && npm run graphql:schema && cd ../.. && npm run lint
git add app/server/graphql
git commit -m "fix(server): refuse the admin row in the three mutations that could name it"
```

---

### Task 12: Forgot and reset over REST

**Files:**
- Create: `app/server/routes/password.ts`
- Test: `app/server/routes/password.test.ts`
- Modify: `app/server/routes/ui.ts` (generalize the limiter, mount the router, `public-config`)
- Test: `app/server/routes/ui.test.ts`

**Interfaces:**
- Consumes: `findUserByEmail` (Task 6), `issueEmailToken`/`consumeEmailToken`/`invalidateEmailTokens` (Task 5), `passwordResetMessage` (Task 3), `hashLoginPassword` + `revokeAllForUsername` (existing), `Mailer` (Task 2).
- Produces:

```ts
export function createPasswordRouter(deps: {
  prisma: PrismaClient; config: AppConfig; mailer: Mailer | null;
  rateLimit: express.RequestHandler;
}): express.Router;
// and, from routes/ui.ts:
export function createIpRateLimit(options: {
  now?: () => number; trustProxyHops?: number;
  maxAttempts: number; windowMs: number; label: string;
}): express.RequestHandler & { size: () => number };
```

- [ ] **Step 1: Generalize the rate limiter first**

`createLoginRateLimit` is IP-keyed with `LOGIN_RATE_LIMIT_MAX_ATTEMPTS`/`_WINDOW_MS` hardcoded, and its doc comment records three bugs already fixed in it (per-key staleness, the size-gated sweep, proxy hops). Parameterize rather than duplicate.

Rename to `createIpRateLimit` taking the options object above. Keep every existing behaviour and every line of the doc comment, adding:

```
 * `maxAttempts`/`windowMs`/`label` are parameters rather than module constants
 * because a second caller exists: the password-reset routes want a tighter
 * 5-per-minute window, and duplicating this function to get it would duplicate a
 * body whose comments document three separate fixes. `label` appears in the
 * rate-limit log line so the two instances are distinguishable.
```

Change the log line to `log.warn(\`${options.label} rate limit exceeded for ${ip}\`)` and the 429 body to a message parameterized the same way, then construct the login instance with the existing constants:

```ts
  const loginRateLimit = createIpRateLimit({
    now: loginRateLimitNow,
    trustProxyHops: config.trustProxyHops ?? 0,
    maxAttempts: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    label: 'Login',
  });
```

Update `routes/ui.test.ts`'s existing limiter tests to the new signature — they must keep asserting the same behaviour, including the sweep test that calls `.size()`. Run them before moving on:

Run: `cd app/server && npx vitest run routes/ui.test.ts -t 'rate limit'`
Expected: PASS with no behaviour change.

- [ ] **Step 2: Write the failing route tests**

Create `app/server/routes/password.test.ts`:

```ts
describe('POST /api/password/forgot', () => {
  it('sends a reset code to a verified address', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'old-password');
    await setUserEmail(prisma, id, 'ann@example.com');
    await markEmailVerified(prisma, id);

    const res = await request(app).post('/api/password/forgot').send({ email: 'ann@example.com' });

    expect(res.status).toBe(204);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].subject).toContain('Reset');
  });

  it('returns 204 with an empty body for an unknown address, and sends nothing', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const res = await request(app).post('/api/password/forgot').send({ email: 'who@example.com' });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns 204 for an UNVERIFIED address, and sends nothing', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'old-password');
    await setUserEmail(prisma, id, 'ann@example.com'); // never verified
    const res = await request(app).post('/api/password/forgot').send({ email: 'ann@example.com' });
    expect(res.status).toBe(204);
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns 204 for the config admin, and sends nothing', async () => {
    const { app, mailer } = build({ mail: MAIL_CONFIG });
    const adminId = await ensureAdminUser(prisma, 'admin');
    await setUserEmail(prisma, adminId, 'boss@example.com');
    await markEmailVerified(prisma, adminId);

    const res = await request(app).post('/api/password/forgot').send({ email: 'boss@example.com' });

    // The admin's password is the add-on options value; a reset link would
    // promise something this app cannot deliver. Same 204 as every other case, so
    // the response reveals nothing.
    expect(res.status).toBe(204);
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns 204 for a malformed address', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    expect((await request(app).post('/api/password/forgot').send({ email: 'nope' })).status).toBe(204);
  });

  it('returns 404 when mail is unconfigured', async () => {
    const { app } = build({ mail: null });
    const res = await request(app).post('/api/password/forgot').send({ email: 'a@b.co' });
    expect(res.status).toBe(404);
  });

  it('rate-limits by IP', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/password/forgot').send({ email: 'a@b.co' });
    }
    const res = await request(app).post('/api/password/forgot').send({ email: 'a@b.co' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/password/reset', () => {
  const primed = async () => {
    const built = build({ mail: MAIL_CONFIG });
    const id = await createReader('ann', 'old-password');
    await setUserEmail(prisma, id, 'ann@example.com');
    await markEmailVerified(prisma, id);
    await request(built.app).post('/api/password/forgot').send({ email: 'ann@example.com' });
    const code = /\b[0-9A-HJKMNP-TV-Z]{8}\b/.exec(built.mailer.sent[0].text)![0];
    return { ...built, id, code };
  };

  it('sets the new password and lets the user log in with it', async () => {
    const { app, code } = await primed();

    const res = await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });

    expect(res.status).toBe(204);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'ann', password: 'a-brand-new-password' });
    expect(login.status).toBe(200);
  });

  it('revokes every outstanding refresh token', async () => {
    const { app, id, code } = await primed();
    await request(app).post('/api/login').send({ username: 'ann', password: 'old-password' });
    expect(await prisma.refreshToken.count({ where: { userId: id } })).toBeGreaterThan(0);

    await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });

    expect(await prisma.refreshToken.count({ where: { userId: id } })).toBe(0);
  });

  it('clears a pending forced password change', async () => {
    const { app, id, code } = await primed();
    await prisma.user.update({ where: { id }, data: { mustChangePassword: true } });

    await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });

    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).mustChangePassword).toBe(false);
  });

  it('consumes the code', async () => {
    const { app, code } = await primed();
    const body = { email: 'ann@example.com', code, newPassword: 'a-brand-new-password' };
    expect((await request(app).post('/api/password/reset').send(body)).status).toBe(204);
    expect((await request(app).post('/api/password/reset').send(body)).status).toBe(400);
  });

  it.each([
    ['a wrong code', { code: 'WRONGONE' }],
    ['an unknown address', { email: 'who@example.com' }],
    ['a too-short password', { newPassword: 'short' }],
  ])('rejects %s with an identical 400', async (_label, override) => {
    const { app, code } = await primed();
    const res = await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password', ...override });
    expect(res.status).toBe(400);
  });

  it('rejects a code whose address has since changed', async () => {
    const { app, id, code } = await primed();
    await prisma.user.update({
      where: { id }, data: { email: 'moved@example.com', emailKey: 'moved@example.com' },
    });
    const res = await request(app)
      .post('/api/password/reset')
      .send({ email: 'ann@example.com', code, newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(400);
  });
});
```

Add to `routes/ui.test.ts`:

```ts
describe('GET /api/public-config', () => {
  it('reports emailEnabled false when mail is unconfigured', async () => {
    const res = await request(buildApp({ mail: null })).get('/api/public-config');
    expect(res.body.emailEnabled).toBe(false);
  });

  it('reports emailEnabled true when it is', async () => {
    const res = await request(buildApp({ mail: MAIL_CONFIG })).get('/api/public-config');
    expect(res.body.emailEnabled).toBe(true);
  });

  it('never exposes the credentials', async () => {
    const res = await request(buildApp({ mail: MAIL_CONFIG })).get('/api/public-config');
    expect(JSON.stringify(res.body)).not.toContain(MAIL_CONFIG.apiToken);
    expect(JSON.stringify(res.body)).not.toContain(MAIL_CONFIG.accountId);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd app/server && npx vitest run routes/password.test.ts routes/ui.test.ts`
Expected: FAIL — `/api/password/*` 404s; `emailEnabled` is undefined.

- [ ] **Step 4: Write the router**

Create `app/server/routes/password.ts`:

```ts
/**
 * The unauthenticated half of the email work: "I forgot my password".
 *
 * REST, not GraphQL, for two reasons that both point the same way — every field
 * in the GraphQL schema is gated on `authenticated`, and these routes sit beside
 * `/api/login` where the IP rate limiter already lives. They are also exempted
 * from both credential gates (`middleware/auth.ts`), because a caller who owes a
 * password change or an address may legitimately be resetting by email.
 *
 * `forgot` ALWAYS answers 204 with an empty body. Unknown address, unverified
 * address, malformed address and the config admin are indistinguishable, so the
 * endpoint cannot be used to test whether an address has an account here.
 */
import express, { Request, Response, Router } from 'express';

import type { PrismaClient } from '@prisma/client';

import { logger } from '../logger';
import { findUserByEmail } from '../services/email';
import { consumeEmailToken, invalidateEmailTokens, issueEmailToken } from '../services/email-token';
import { passwordResetMessage } from '../services/mail-template';
import { isMailConfigured, type Mailer } from '../services/mailer';
import { hashLoginPassword } from '../services/password';
import { revokeAllForUsername } from '../services/token';
import type { AppConfig } from '../types';
import { asyncHandler } from '../utils/async-handler';

const log = logger('Password');

/**
 * A NEW floor, introduced here and deliberately stricter than anything else in
 * this codebase: `userChangePassword` enforces only `z.string().min(1)` and the
 * client checks only non-empty-and-matching, so no password length rule exists
 * today. This route is the one password entry point a stranger can reach without
 * being signed in, and matching `min(1)` would let an email-driven reset set a
 * one-character password.
 *
 * The asymmetry is intentional: reset refuses something the authenticated change
 * path allows. Do NOT "fix" it by lowering this to 1.
 */
const MIN_PASSWORD_LENGTH = 8;

export function createPasswordRouter(deps: {
  prisma: PrismaClient;
  config: AppConfig;
  mailer: Mailer | null;
  rateLimit: express.RequestHandler;
}): Router {
  const router = Router();
  const { prisma, config, mailer, rateLimit } = deps;

  // Mail off ⇒ the whole flow does not exist. 404 rather than 503: there is no
  // resource here to be temporarily unavailable, and the client already hides the
  // affordance via `emailEnabled`.
  const requireMail = (_req: Request, res: Response, next: express.NextFunction): void => {
    if (!isMailConfigured(config) || mailer === null) {
      res.sendStatus(404);
      return;
    }
    next();
  };

  router.post(
    '/api/password/forgot',
    rateLimit,
    requireMail,
    asyncHandler(async (req: Request, res: Response) => {
      const { email } = req.body as { email?: unknown };
      // Answer first, work second: the response is identical in every case, and
      // deciding it up front makes it impossible for a later branch to leak one.
      res.sendStatus(204);
      if (typeof email !== 'string') return;

      const account = await findUserByEmail(prisma, email);
      if (account === null || account.email === null) return;
      if (account.emailVerifiedAt === null) {
        log.warn('Password reset requested for an unverified address — not sending');
        return;
      }
      if (account.isConfigAdmin) {
        // The admin's password is `config.password`, read from the add-on
        // options. Nothing this endpoint could send would change it.
        log.warn('Password reset requested for the admin account — not sending');
        return;
      }

      const issued = await issueEmailToken(prisma, {
        userId: account.id,
        purpose: 'reset',
        email: account.email,
      });
      if (!issued.ok) {
        log.warn(`Password reset throttled for "${account.username}" (${issued.reason})`);
        return;
      }
      const result = await mailer!.send(
        passwordResetMessage({
          to: account.email,
          code: issued.code,
          libraryName: config.libraryName,
          publicUrl: config.publicUrl ?? null,
        })
      );
      if (!result.ok) {
        log.warn(`Password reset email failed for "${account.username}" (${result.reason})`);
      }
    })
  );

  router.post(
    '/api/password/reset',
    rateLimit,
    requireMail,
    asyncHandler(async (req: Request, res: Response) => {
      const { email, code, newPassword } = req.body as {
        email?: unknown;
        code?: unknown;
        newPassword?: unknown;
      };
      // One 400 for every failure — wrong code, unknown address, weak password,
      // expired token. The user's next action is the same in all of them, and
      // distinguishing them tells a guesser which half of the guess landed.
      const reject = (reason: string): void => {
        log.warn(`Password reset rejected — ${reason}`);
        res.status(400).json({ error: 'That reset code is not valid or has expired.' });
      };

      if (typeof email !== 'string' || typeof code !== 'string' || typeof newPassword !== 'string') {
        reject('malformed body');
        return;
      }
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        reject('new password too short');
        return;
      }
      const account = await findUserByEmail(prisma, email);
      if (account === null || account.isConfigAdmin) {
        reject('no eligible account for that address');
        return;
      }
      const consumed = await consumeEmailToken(prisma, {
        userId: account.id,
        purpose: 'reset',
        code,
      });
      if (consumed === null) {
        reject('unknown, used or expired code');
        return;
      }
      // The token records the address it was sent to, so a code minted before an
      // address change cannot be spent after it.
      if (account.email === null || consumed.email !== account.email) {
        reject('code was issued for a different address');
        return;
      }

      await prisma.user.update({
        where: { id: account.id },
        data: {
          passwordHash: await hashLoginPassword(newPassword),
          // A reset satisfies the forced-change requirement: the user just chose
          // this password themselves.
          mustChangePassword: false,
        },
      });
      // Same side effect `userChangePassword` has, for the same reason: a stolen
      // or stale refresh token must not outlive a password change.
      await revokeAllForUsername(prisma, account.username);
      await invalidateEmailTokens(prisma, account.id, 'reset');
      log.info(`Password reset completed for "${account.username}"`);
      res.sendStatus(204);
    })
  );

  return router;
}
```

- [ ] **Step 5: Mount it and extend `public-config`**

In `routes/ui.ts`, build a second limiter and mount the router **before** the two gates (so the gate exemptions are belt-and-braces rather than the only protection):

```ts
  const passwordRateLimit = createIpRateLimit({
    now: loginRateLimitNow,
    trustProxyHops: config.trustProxyHops ?? 0,
    // Tighter than login's 10: a legitimate user submits one forgot request and
    // one reset, and the cost of a wrong guess here is a password, not a session.
    maxAttempts: 5,
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    label: 'Password reset',
  });
  router.use(createPasswordRouter({ prisma, config, mailer, rateLimit: passwordRateLimit }));
```

`createUiRouter` takes `mailer` in its options object; thread it from `server.ts`, which already receives it from `index.ts` (Task 10).

Extend `/api/public-config`:

```ts
  router.get('/api/public-config', (_req: Request, res: Response) => {
    // `emailEnabled` only — never any part of the credentials. This endpoint is
    // unauthenticated, and the client needs exactly one bit: whether to offer the
    // forgot-password link and the "username or email" affordance.
    res.json({ libraryName: config.libraryName, emailEnabled: isMailConfigured(config) });
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd app/server && npm test`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add app/server/routes app/server/server.ts
git commit -m "feat(server): add password forgot and reset over email"
```

---
### Task 13: Client plumbing — the claim, the hook, and `emailEnabled`

**Files:**
- Modify: `app/client/src/lib/token.ts` (`AuthClaims.mustSetEmail`)
- Test: `app/client/src/lib/token.test.ts`
- Create: `app/client/src/provider/auth/hook/use-must-set-email.ts`
- Modify: `app/client/src/provider/auth/hook/index.ts`, `app/client/src/provider/auth/index.ts`
- Modify: `app/client/src/provider/config/{context.ts,provider.tsx,index.ts}`
- Test: `app/client/src/provider/auth/provider.test.tsx`

**Interfaces:**
- Consumes: the `mustSetEmail` claim (Task 9) and `emailEnabled` (Task 12).
- Produces: `useMustSetEmail(): [boolean]`, `useEmailEnabled(): boolean`.

- [ ] **Step 1: Write the failing tests**

In `app/client/src/lib/token.test.ts`:

```ts
it('reads mustSetEmail from a token that carries it', () => {
  const token = makeToken({ username: 'ann', isAdmin: false, mustChangePassword: false, mustSetEmail: true });
  expect(decodeClaims(token)?.mustSetEmail).toBe(true);
});

it('treats a token minted before the claim existed as not needing an email', () => {
  // Tokens from the previous version survive in localStorage for up to 15
  // minutes after an upgrade. Rejecting them here would log every signed-in user
  // out; the server gates on database state regardless of the claim.
  const token = makeToken({ username: 'ann', isAdmin: false, mustChangePassword: false });
  expect(decodeClaims(token)).not.toBeNull();
  expect(decodeClaims(token)?.mustSetEmail).toBe(false);
});
```

`makeToken` is `lib/test-jwt.ts`'s existing helper; widen its parameter type rather than adding a second helper.

In `app/client/src/provider/auth/provider.test.tsx`:

```ts
it('exposes mustSetEmail from the current token', () => {
  setToken(makeToken({ username: 'ann', isAdmin: false, mustChangePassword: false, mustSetEmail: true }));
  const { result } = renderHook(() => useMustSetEmail(), { wrapper: AuthProvider });
  expect(result.current[0]).toBe(true);
});
```

Add a config-provider test asserting `useEmailEnabled()` is `false` before the fetch resolves and `true` once `/api/public-config` answers `{ emailEnabled: true }`, mirroring however that file already stubs `fetch`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app/client && npx vitest run src/lib/token.test.ts src/provider/auth/provider.test.tsx`
Expected: FAIL — `mustSetEmail` is not on `AuthClaims`; `useMustSetEmail` is not exported.

- [ ] **Step 3: Add the claim**

In `lib/token.ts`, add `mustSetEmail: boolean;` to `AuthClaims` and, in `decodeClaims`, `mustSetEmail: p.mustSetEmail === true,` — deliberately **outside** the strict contract guard, with:

```ts
    // NOT part of the required contract above, unlike `mustChangePassword`: a
    // token issued before this claim existed must keep decoding, or an upgrade
    // signs every active user out. `=== true` makes a missing claim false, which
    // is the safe direction — the server gates independently.
```

- [ ] **Step 4: Add the hook**

Create `app/client/src/provider/auth/hook/use-must-set-email.ts`, copying `use-must-change-password.ts` exactly and reading `mustSetEmail`. Export it from both `hook/index.ts` and `provider/auth/index.ts`.

- [ ] **Step 5: Add `emailEnabled` to the config provider**

```tsx
export const ConfigProvider = ({ children }: ConfigProviderProps) => {
  const [libraryName, setLibraryName] = useState('Bookplate');
  // Defaults to false so the forgot-password link and the email login hint are
  // hidden until the server says mail exists — the safe direction, since
  // offering a dead affordance is worse than briefly hiding a live one.
  const [emailEnabled, setEmailEnabled] = useState(false);

  useEffect(() => {
    void fetch('/api/public-config')
      .then((r) => r.json() as Promise<{ libraryName: string; emailEnabled?: boolean }>)
      .then((cfg) => {
        if (cfg.libraryName) setLibraryName(cfg.libraryName);
        setEmailEnabled(cfg.emailEnabled === true);
      })
      .catch(() => {
        // keep defaults on failure
      });
  }, []);

  return <Context.Provider value={{ libraryName, emailEnabled }}>{children}</Context.Provider>;
};
```

Add `emailEnabled: boolean` to the context type with a `false` default, and export `useEmailEnabled` beside the existing `useLibraryName`.

- [ ] **Step 6: Run the tests, lint, commit**

```bash
cd app/client && npx vitest run src/lib src/provider && cd ../.. && npm run lint
git add app/client/src/lib app/client/src/provider
git commit -m "feat(client): read the mustSetEmail claim and the emailEnabled config flag"
```

---

### Task 14: The set-email gate screen

**Files:**
- Create: `app/client/src/page/set-email/{index.tsx,style.ts,index.test.tsx}`
- Modify: `app/client/src/page/index.ts`
- Modify: `app/client/src/router/{path.ts,path-internal.ts,component.tsx,protected-route.tsx}`
- Test: `app/client/src/router/protected-route.test.tsx`
- Create: `app/client/src/graphql/email.ts` (the three documents)

**Interfaces:**
- Consumes: `useMustSetEmail` (Task 13), `viewerSetEmail`/`viewerConfirmEmail`/`viewerResendEmailVerification` (Task 10), `refreshAccessToken` from `lib/api-fetch.ts`.
- Produces: `path.setEmail()`, `SetEmailPage`, and the documents `ViewerSetEmailDocument`, `ViewerConfirmEmailDocument`, `ViewerResendEmailVerificationDocument`.

- [ ] **Step 1: Write the failing redirect tests**

In `app/client/src/router/protected-route.test.tsx`:

```ts
it('sends a viewer who owes an address to the set-email page', () => {
  renderAt('/library', { username: 'ann', mustChangePassword: false, mustSetEmail: true });
  expect(currentPath()).toBe('/set-email');
});

it('sends a viewer who owes a password change to the password page FIRST', () => {
  // Ordering matters: a new account owes both, and choosing a password is the
  // step that must come first.
  renderAt('/library', { username: 'ann', mustChangePassword: true, mustSetEmail: true });
  expect(currentPath()).toBe('/password-reset');
});

it('bounces a viewer off the set-email page once they have an address', () => {
  renderAt('/set-email', { username: 'ann', mustChangePassword: false, mustSetEmail: false });
  expect(currentPath()).toBe('/');
});

it('leaves an ordinary viewer alone', () => {
  renderAt('/library', { username: 'ann', mustChangePassword: false, mustSetEmail: false });
  expect(currentPath()).toBe('/library');
});
```

- [ ] **Step 2: Write the failing page tests**

Create `app/client/src/page/set-email/index.test.tsx`:

```tsx
describe('SetEmailPage', () => {
  it('saves an address and then asks for the code', async () => {
    const user = userEvent.setup();
    renderWithApollo(<SetEmailPage />, { mocks: [setEmailMock('ann@example.com')] });

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByPlaceholderText(/code/i)).toBeInTheDocument();
  });

  it('refreshes the access token after confirming, so the gate lifts at once', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn().mockResolvedValue(true);
    vi.spyOn(apiFetch, 'refreshAccessToken').mockImplementation(refresh);
    renderWithApollo(<SetEmailPage />, {
      mocks: [setEmailMock('ann@example.com'), confirmEmailMock('K7M2QX4P')],
    });

    await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await user.type(await screen.findByPlaceholderText(/code/i), 'K7M2QX4P');
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    // Without this the viewer stays gated for up to 15 minutes on a claim that is
    // already stale. Note it does NOT log out — unlike the forced-password page,
    // nothing here revokes a refresh token.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('shows the error message when the address is already in use', async () => {
    const user = userEvent.setup();
    renderWithApollo(<SetEmailPage />, { mocks: [emailInUseMock('shared@example.com')] });

    await user.type(screen.getByPlaceholderText('Email address'), 'shared@example.com');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  it('prefills the code from the ?code= query parameter', async () => {
    renderWithApollo(<SetEmailPage />, { mocks: [], route: '/set-email?code=K7M2QX4P' });
    expect(await screen.findByDisplayValue('K7M2QX4P')).toBeInTheDocument();
  });
});
```

Build the mock helpers from `MockedResponse<ViewerSetEmailMutation, ViewerSetEmailMutationVariables>` the way `page/password-reset/index.test.tsx` builds `successMock`.

- [ ] **Step 3: Run them to verify they fail**

Run: `cd app/client && npx vitest run src/router src/page/set-email`
Expected: FAIL — no such module/page; redirects go nowhere.

- [ ] **Step 4: Add the documents**

Create `app/client/src/graphql/email.ts`:

```ts
import { graphql } from '~/gql';

/**
 * Three mutations, one file: they are the whole email-setup flow and are always
 * changed together. `__typename` is selected on every union member because the
 * pages branch on it through `unwrapResult`.
 */
export const ViewerSetEmailDocument = graphql(`
  mutation ViewerSetEmail($input: ViewerSetEmailInput!) {
    viewerSetEmail(input: $input) {
      __typename
      ... on ViewerSetEmailPayload {
        email
        delivered
      }
      ... on UserError {
        message
      }
    }
  }
`);

export const ViewerConfirmEmailDocument = graphql(`
  mutation ViewerConfirmEmail($input: ViewerConfirmEmailInput!) {
    viewerConfirmEmail(input: $input) {
      __typename
      ... on ViewerConfirmEmailPayload {
        email
      }
      ... on UserError {
        message
      }
    }
  }
`);

export const ViewerResendEmailVerificationDocument = graphql(`
  mutation ViewerResendEmailVerification {
    viewerResendEmailVerification {
      __typename
      ... on ViewerResendEmailVerificationPayload {
        delivered
      }
      ... on UserError {
        message
      }
    }
  }
`);
```

Run codegen (`cd app/client && npm run codegen`, or whatever `codegen.ts` is wired to) before writing the page, so the generated types exist.

- [ ] **Step 5: Write the page**

Create `app/client/src/page/set-email/index.tsx`. Two stages in one screen — address, then code — modelled on `page/password-reset/index.tsx`'s structure (`Page type="minimal"`, `BrandLockup`, `Card`, `useActionState`, `useToast`):

```tsx
/**
 * Where `ProtectedRoute` sends every `mustSetEmail` viewer. Like the forced
 * password-change page it must render and submit with NO prior GraphQL query —
 * every `Query` field is gated on `authenticated`, which is false for a gated
 * viewer — so this component has no `useQuery` of its own.
 *
 * It differs from that page in one important way: confirming here does NOT log
 * the caller out. `userChangePassword` revokes every refresh token as a side
 * effect and therefore has to end the session; setting an address revokes
 * nothing, so the page mints a fresh access token via `refreshAccessToken()` —
 * which rebuilds claims from current state — and the gate lifts immediately
 * instead of after the 15-minute token TTL.
 */
export const SetEmailPage = () => {
  const styles = useStyle();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const [runSetEmail] = useMutation(ViewerSetEmailDocument);
  const [runConfirm] = useMutation(ViewerConfirmEmailDocument);
  const [runResend] = useMutation(ViewerResendEmailVerificationDocument);

  const [email, setEmail] = useState<string>('');
  // A code in the URL means the viewer followed the link from their inbox, so the
  // address is already saved and only the code stage is left.
  const [code, setCode] = useState<string>(searchParams.get('code') ?? '');
  const [stage, setStage] = useState<'address' | 'code'>(
    searchParams.get('code') === null ? 'address' : 'code'
  );

  const [, submitAddress, isSaving] = useActionState(async () => {
    const { data } = await runSetEmail({ variables: { input: { email } } });
    const result = data?.viewerSetEmail;
    if (result?.__typename === 'ViewerSetEmailPayload') {
      showToast(
        result.delivered
          ? 'Check your inbox for the confirmation code'
          : 'Address saved, but the email could not be sent — try resending',
        result.delivered ? 'success' : 'error'
      );
      setStage('code');
    } else if (result && 'message' in result) {
      showToast(result.message, 'error');
    } else {
      showToast('Could not save that address', 'error');
    }
    return null;
  }, null);

  const [, submitCode, isConfirming] = useActionState(async () => {
    const { data } = await runConfirm({ variables: { input: { code } } });
    const result = data?.viewerConfirmEmail;
    if (result?.__typename === 'ViewerConfirmEmailPayload') {
      showToast('Email confirmed', 'success');
      await refreshAccessToken();
      window.location.assign(path.home());
    } else if (result && 'message' in result) {
      showToast(result.message, 'error');
    } else {
      showToast('Could not confirm that code', 'error');
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <Card className={styles.card}>
          {stage === 'address' ? (
            <form className={styles.form} action={submitAddress}>
              <p className={styles.lead}>
                Add an email address to your account. We&rsquo;ll send a code to confirm it.
              </p>
              <TextInput
                placeholder="Email address"
                name="email"
                autoCapitalize="none"
                onChange={(value) => setEmail(value ?? '')}
                value={email}
              />
              <Button submit loading={isSaving} type="primary" radius="card">
                Send confirmation code
              </Button>
            </form>
          ) : (
            <form className={styles.form} action={submitCode}>
              <p className={styles.lead}>
                Enter the code we sent to {email === '' ? 'your email address' : email}.
              </p>
              <TextInput
                placeholder="Confirmation code"
                name="code"
                autoCapitalize="characters"
                onChange={(value) => setCode(value ?? '')}
                value={code}
              />
              <Button submit loading={isConfirming} type="primary" radius="card">
                Confirm
              </Button>
              <Button type="text" onClick={() => void runResend()}>
                Resend code
              </Button>
              <Button type="text" onClick={() => setStage('address')}>
                Use a different address
              </Button>
            </form>
          )}
        </Card>
      </div>
    </Page>
  );
};
```

Copy `page/password-reset/style.ts` as this page's starting point — the two
screens are the same shape — adding the `lead` rule. If `Button`'s `type` union
has no `text` member, use whichever variant that codebase already uses for a
secondary in-card action (check `component/sync-password`), rather than adding a
variant.

- [ ] **Step 6: Register the route and the redirect**

`path-internal.ts`: `export const setEmail = () => '/set-email';`
`path.ts`: `export const setEmail = () => pathInternal.setEmail();`
`page/index.ts`: export `SetEmailPage`.
`router/component.tsx`: add the route inside the protected layout, beside `passwordReset`.

`protected-route.tsx`:

```tsx
  const [mustSetEmail] = useMustSetEmail();
  // ...
  if (mustChangePassword && location.pathname !== path.passwordReset()) {
    return <Navigate to={path.passwordReset()} replace />;
  }
  // AFTER the password redirect, deliberately: a new account owes both, and
  // choosing a password comes first. Also mirrors the server, where
  // passwordChangeGate is mounted ahead of emailSetupGate.
  if (!mustSetEmail && location.pathname === path.setEmail()) {
    return <Navigate to={path.home()} replace />;
  }
  if (mustSetEmail && location.pathname !== path.setEmail()) {
    return <Navigate to={path.setEmail()} replace />;
  }
```

- [ ] **Step 7: Run the tests, lint, commit**

```bash
cd app/client && npx vitest run src/router src/page/set-email && cd ../.. && npm run lint
git add app/client/src
git commit -m "feat(client): add the set-email gate screen"
```

---

### Task 15: Forgot and reset screens

**Files:**
- Create: `app/client/src/page/forgot-password/{index.tsx,style.ts,index.test.tsx}`
- Create: `app/client/src/page/reset-password/{index.tsx,style.ts,index.test.tsx}`
- Modify: `app/client/src/page/login/index.tsx` + `index.test.tsx`
- Modify: `app/client/src/page/index.ts`, `app/client/src/router/{path.ts,path-internal.ts,component.tsx}`

**Interfaces:**
- Consumes: `POST /api/password/forgot`, `POST /api/password/reset` (Task 12), `useEmailEnabled` (Task 13).
- Produces: `path.forgotPassword()`, `path.resetPasswordByEmail()` → `/reset-password`, `ForgotPasswordPage`, `ResetPasswordPage`.

**Naming:** these are *unprotected* routes (`UnprotectedRoute`), unlike `/password-reset`, which is the protected forced-change screen. Register them accordingly.

- [ ] **Step 1: Write the failing tests**

`page/forgot-password/index.test.tsx`:

```tsx
it('reports the same message whether or not the address exists', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
  render(<ForgotPasswordPage />);

  await user.type(screen.getByPlaceholderText('Email address'), 'who@example.com');
  await user.click(screen.getByRole('button', { name: /send/i }));

  // The server answers 204 for every case by design; the client must not invent a
  // distinction it was careful not to make.
  expect(await screen.findByText(/if that address has an account/i)).toBeInTheDocument();
});

it('surfaces the rate limit distinctly from a failure', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 429, headers: new Headers({ 'Retry-After': '42' }),
  }));
  render(<ForgotPasswordPage />);
  await user.type(screen.getByPlaceholderText('Email address'), 'a@b.co');
  await user.click(screen.getByRole('button', { name: /send/i }));
  expect(await screen.findByText(/42 seconds/)).toBeInTheDocument();
});

it('links onward to the code-entry screen', async () => {
  render(<ForgotPasswordPage />);
  expect(screen.getByRole('link', { name: /have a code/i })).toHaveAttribute(
    'href', '/reset-password'
  );
});
```

`page/reset-password/index.test.tsx`:

```tsx
it('submits the address, code and new password, then sends the user to log in', async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  render(<ResetPasswordPage />);

  await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
  await user.type(screen.getByPlaceholderText('Reset code'), 'K7M2QX4P');
  await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
  await user.type(screen.getByPlaceholderText('Confirm new password'), 'a-brand-new-password');
  await user.click(screen.getByRole('button', { name: /reset password/i }));

  expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
    email: 'ann@example.com', code: 'K7M2QX4P', newPassword: 'a-brand-new-password',
  });
  expect(await screen.findByText(/password reset/i)).toBeInTheDocument();
});

it('will not submit when the two passwords differ', async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<ResetPasswordPage />);
  await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
  await user.type(screen.getByPlaceholderText('Reset code'), 'K7M2QX4P');
  await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
  await user.type(screen.getByPlaceholderText('Confirm new password'), 'different-password');
  await user.click(screen.getByRole('button', { name: /reset password/i }));
  expect(fetchMock).not.toHaveBeenCalled();
});

it('prefills the code from ?code=', () => {
  render(<ResetPasswordPage />, { route: '/reset-password?code=K7M2QX4P' });
  expect(screen.getByDisplayValue('K7M2QX4P')).toBeInTheDocument();
});

it('shows one message for every rejected code', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 400,
    json: () => Promise.resolve({ error: 'That reset code is not valid or has expired.' }),
  }));
  render(<ResetPasswordPage />);
  await user.type(screen.getByPlaceholderText('Email address'), 'ann@example.com');
  await user.type(screen.getByPlaceholderText('Reset code'), 'WRONGONE');
  await user.type(screen.getByPlaceholderText('New password'), 'a-brand-new-password');
  await user.type(screen.getByPlaceholderText('Confirm new password'), 'a-brand-new-password');
  await user.click(screen.getByRole('button', { name: /reset password/i }));
  expect(await screen.findByText(/not valid or has expired/i)).toBeInTheDocument();
});
```

`page/login/index.test.tsx`:

```tsx
it('offers a forgot-password link when email is enabled', () => {
  renderWithConfig(<LoginPage />, { emailEnabled: true });
  expect(screen.getByRole('link', { name: /forgot/i })).toHaveAttribute('href', '/forgot-password');
});

it('offers no forgot-password link when email is disabled', () => {
  renderWithConfig(<LoginPage />, { emailEnabled: false });
  expect(screen.queryByRole('link', { name: /forgot/i })).toBeNull();
});

it('labels the identifier field for email when email is enabled', () => {
  renderWithConfig(<LoginPage />, { emailEnabled: true });
  expect(screen.getByPlaceholderText('Username or email')).toBeInTheDocument();
});

it('labels it Username when email is disabled', () => {
  renderWithConfig(<LoginPage />, { emailEnabled: false });
  expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app/client && npx vitest run src/page/forgot-password src/page/reset-password src/page/login`
Expected: FAIL — the two pages do not exist; the login page has no link and a fixed placeholder.

- [ ] **Step 3: Write the forgot page**

`page/forgot-password/index.tsx` — plain `fetch`, no Apollo (the route is unauthenticated and the endpoint is REST):

```tsx
/**
 * Deliberately says the same thing for every outcome except a rate limit: the
 * server answers 204 for an unknown address, an unverified one, and the admin
 * alike, specifically so this screen cannot be used to discover whether an
 * address has an account. Inventing a distinction here would undo that.
 */
export const ForgotPasswordPage = () => {
  const styles = useStyle();
  const [email, setEmail] = useState<string>('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, submitAction, isPending] = useActionState(async () => {
    setError(null);
    try {
      const response = await fetch('/api/password/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        setError(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Too many attempts — try again in ${retryAfter} seconds`
            : 'Too many attempts — please wait a moment and try again'
        );
        return null;
      }
      setSent(true);
    } catch {
      setError('Network error — please try again');
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <Card className={styles.card}>
          {sent ? (
            <p className={styles.lead}>
              If that address has an account, a reset code is on its way.
            </p>
          ) : (
            <form className={styles.form} action={submitAction}>
              <p className={styles.lead}>
                Enter your email address and we&rsquo;ll send you a reset code.
              </p>
              <TextInput
                placeholder="Email address"
                name="email"
                autoCapitalize="none"
                onChange={(value) => setEmail(value ?? '')}
                value={email}
              />
              <Button submit loading={isPending} type="primary" radius="card">
                Send reset code
              </Button>
              {error === null ? null : <p className={styles.error}>{error}</p>}
            </form>
          )}
          {/* In BOTH states: a user who already has a code should not have to
              submit the form to reach the next screen. */}
          <Link className={styles.link} to={path.resetPasswordByEmail()}>
            I have a code
          </Link>
          <Link className={styles.link} to={path.login()}>
            Back to sign in
          </Link>
        </Card>
      </div>
    </Page>
  );
};
```

- [ ] **Step 4: Write the reset page**

`page/reset-password/index.tsx`, same shape:

```tsx
export const ResetPasswordPage = () => {
  const styles = useStyle();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState<string>('');
  // Prefilled when the user followed the link from their inbox.
  const [code, setCode] = useState<string>(searchParams.get('code') ?? '');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Client-side only, and NOT a security boundary: the server enforces the
  // 8-character floor independently. This avoids a round-trip and gives the
  // mismatch its own message instead of the server's single generic one.
  const canSubmit =
    email !== '' && code !== '' && newPassword.length >= 8 && newPassword === confirmPassword;

  const [, submitAction, isPending] = useActionState(async () => {
    setError(null);
    if (!canSubmit) {
      setError(
        newPassword !== confirmPassword
          ? 'Those passwords do not match'
          : 'Fill in every field; the new password must be at least 8 characters'
      );
      return null;
    }
    try {
      const response = await fetch('/api/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      if (response.status === 204) {
        setDone(true);
        return null;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        setError(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? `Too many attempts — try again in ${retryAfter} seconds`
            : 'Too many attempts — please wait a moment and try again'
        );
        return null;
      }
      // The server speaks ONE message for every rejected code — wrong, expired,
      // already used, unknown address. Show it verbatim rather than guessing at a
      // more specific cause the response deliberately does not carry.
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'That reset code is not valid or has expired.');
    } catch {
      setError('Network error — please try again');
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <Card className={styles.card}>
          {done ? (
            <>
              <p className={styles.lead}>Your password reset — sign in with your new password.</p>
              <Link className={styles.link} to={path.login()}>
                Go to sign in
              </Link>
            </>
          ) : (
            <form className={styles.form} action={submitAction}>
              <TextInput
                placeholder="Email address"
                name="email"
                autoCapitalize="none"
                onChange={(value) => setEmail(value ?? '')}
                value={email}
              />
              <TextInput
                placeholder="Reset code"
                name="code"
                autoCapitalize="characters"
                onChange={(value) => setCode(value ?? '')}
                value={code}
              />
              <TextInput
                placeholder="New password"
                name="newPassword"
                password
                onChange={(value) => setNewPassword(value ?? '')}
                value={newPassword}
              />
              <TextInput
                placeholder="Confirm new password"
                name="confirmPassword"
                password
                onChange={(value) => setConfirmPassword(value ?? '')}
                value={confirmPassword}
              />
              <Button submit loading={isPending} type="primary" radius="card">
                Reset password
              </Button>
              {error === null ? null : <p className={styles.error}>{error}</p>}
              <Link className={styles.link} to={path.login()}>
                Back to sign in
              </Link>
            </form>
          )}
        </Card>
      </div>
    </Page>
  );
};
```

Note the guard runs INSIDE the action rather than disabling the button: the
"passwords do not match" test clicks submit and asserts `fetch` was never called,
and a disabled button would make that assertion vacuous.

- [ ] **Step 5: Update the login page**

```tsx
  const emailEnabled = useEmailEnabled();
  // ...
              <TextInput
                placeholder={emailEnabled ? 'Username or email' : 'Username'}
                name="username"
                autoCapitalize="none"
                onChange={setUsername}
                value={username}
              />
```

and below the submit button:

```tsx
            {emailEnabled ? (
              <Link className={styles.forgot} to={path.forgotPassword()}>
                Forgot password?
              </Link>
            ) : null}
```

The field is still `name="username"` and still posted as `username` — the server treats the value as an identifier and the REST contract is unchanged.

- [ ] **Step 6: Register routes and paths**

`path-internal.ts`:

```ts
export const forgotPassword = () => '/forgot-password';
/** The EMAIL reset flow. `passwordReset()` above is the protected forced-change
 *  screen and is a different thing — see the naming trap in the plan. */
export const resetPasswordByEmail = () => '/reset-password';
```

Mirror both in `path.ts`, export both pages from `page/index.ts`, and register both under `UnprotectedRoute` in `router/component.tsx`.

- [ ] **Step 7: Run the tests, lint, commit**

```bash
cd app/client && npm test && cd ../.. && npm run lint
git add app/client/src
git commit -m "feat(client): add forgot-password and reset-password screens"
```

---

### Task 16: The email section on the settings page

**Files:**
- Create: `app/client/src/component/email-setting/{index.tsx,style.ts,index.test.tsx}`
- Modify: `app/client/src/component/index.ts`
- Modify: `app/client/src/page/user/index.tsx`
- Modify: `app/client/src/graphql/viewer-bootstrap.ts` (or the settings page's own query — whichever supplies `viewer`)

**Interfaces:**
- Consumes: `Viewer.email`/`Viewer.emailVerifiedAt` (Task 10), the three documents from Task 14, `useEmailEnabled` (Task 13).
- Produces: `EmailSetting` component.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('EmailSetting', () => {
  it('shows the address with a confirmed badge', () => {
    renderWithApollo(<EmailSetting email="ann@example.com" emailVerifiedAt={new Date()} />);
    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    expect(screen.getByText(/confirmed/i)).toBeInTheDocument();
  });

  it('offers a resend when the address is unconfirmed', async () => {
    const user = userEvent.setup();
    renderWithApollo(<EmailSetting email="ann@example.com" emailVerifiedAt={null} />, {
      mocks: [resendMock()],
    });
    expect(screen.getByText(/not confirmed/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /resend/i }));
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it('accepts a code inline once one has been sent', async () => {
    const user = userEvent.setup();
    renderWithApollo(<EmailSetting email="ann@example.com" emailVerifiedAt={null} />, {
      mocks: [resendMock(), confirmMock('K7M2QX4P')],
    });
    await user.click(screen.getByRole('button', { name: /resend/i }));
    await user.type(await screen.findByPlaceholderText(/code/i), 'K7M2QX4P');
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/confirmed/i)).toBeInTheDocument();
  });

  it('changes the address and warns that it needs confirming again', async () => {
    const user = userEvent.setup();
    renderWithApollo(<EmailSetting email="old@example.com" emailVerifiedAt={new Date()} />, {
      mocks: [setEmailMock('new@example.com')],
    });
    await user.click(screen.getByRole('button', { name: /change/i }));
    await user.clear(screen.getByPlaceholderText('Email address'));
    await user.type(screen.getByPlaceholderText('Email address'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/not confirmed/i)).toBeInTheDocument();
  });

  it('renders nothing at all when email is disabled on this server', () => {
    renderWithApollo(<EmailSetting email={null} emailVerifiedAt={null} />, { emailEnabled: false });
    expect(screen.queryByText(/email/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app/client && npx vitest run src/component/email-setting`
Expected: FAIL — no such component.

- [ ] **Step 3: Write the component**

Props `{ email: string | null; emailVerifiedAt: Date | null }`. Returns `null` when `useEmailEnabled()` is false — with:

```tsx
  // Rendering nothing rather than a disabled section: on an install without mail
  // an email address does nothing at all, and a greyed-out control invites the
  // user to ask why.
```

Three states: confirmed (address + badge + "Change"), unconfirmed (address + "Not confirmed" + "Resend code" + inline code field once sent), and editing (address field + Save/Cancel). Follow `component/sync-password`'s structure — it is the closest existing analogue (a settings-page card with a value, a badge and an action) — and use `Card`, `FieldList`, `TextInput` and `Button` from `~/component` / `~/control` rather than new markup.

Refetch the settings query after a successful confirm or change so the badge updates from the server rather than from local state (`refetchQueries`, matching how the page's other mutations do it).

- [ ] **Step 4: Add the fields to the query and mount the section**

Add `email` and `emailVerifiedAt` to whichever document supplies `viewer` to the settings page, then render `<EmailSetting email={viewer.email} emailVerifiedAt={viewer.emailVerifiedAt} />` in `page/user/index.tsx` next to the sync-password section.

- [ ] **Step 5: Run the tests, lint, commit**

```bash
cd app/client && npm test && cd ../.. && npm run lint
git add app/client/src
git commit -m "feat(client): manage the account email address on the settings page"
```

---

### Task 17: User-facing documentation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Document the flows in the README**

Extend the "Two separate credentials" and "Connect to the Web UI" sections, stating:

- Signing in accepts a username **or** an email address, once email is configured.
- Every account needs an address when email is configured, and is asked for one on next sign-in; an install with no Cloudflare credentials is unaffected and nothing changes for it.
- An address must be confirmed by a code sent to it. Until it is, no other mail goes to that address and password reset will not work for it.
- "Forgot password" needs a **confirmed** address, and does not apply to the admin: the admin password is the `password` add-on option, changed there.
- Emails always carry a typed code; setting `public_url` additionally puts a clickable link in them.
- The sync password is untouched by all of this — OPDS and KOSync still use it.

- [ ] **Step 2: Add the changelog entry**

Follow `CHANGELOG.md`'s existing format and heading conventions, under the unreleased section, noting the new options, email login, verification, password reset, and — explicitly, because operators need to know — that the admin password is still only changeable through the add-on configuration.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document email login, verification and password reset"
```

---

## Final verification

- [ ] `cd app/server && npm test` — all green
- [ ] `cd app/client && npm test` — all green
- [ ] `npm run lint` **from the repo root** — all green (this is the step that catches the other workspace)
- [ ] `cd app/server && npm run test:cost` — query-cost budgets still hold
- [ ] `cd app/server && npm run graphql:schema:check` — no schema drift
- [ ] Manual smoke test with mail unconfigured: log in, confirm no set-email screen, no forgot-password link, and `/api/password/forgot` returns 404
- [ ] Manual smoke test with mail configured against a real Cloudflare account: set an address, receive the code, confirm it, log out, log in by email, reset the password by email
- [ ] Manual check that the admin can set and confirm their own address, and that "forgot password" for the admin's address sends nothing
