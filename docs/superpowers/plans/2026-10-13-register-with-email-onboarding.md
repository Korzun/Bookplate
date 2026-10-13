# Register with Email and Onboarding Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When mail is configured, an admin registers a user with a required email address; the user receives a welcome email whose link lets them choose a password, verifies the address, and signs them in.

**Architecture:** A new `onboard` `EmailToken` purpose and `welcomeMessage` template (services); `userRegister` creates a password-less account with an address and sends the welcome mail, falling back to today's generated password if the send fails (GraphQL); `POST /api/onboard` exchanges code + new password for a session (REST, beside `/api/login`); the register card gains an Email field gated on `emailEnabled`, and a new unprotected `/welcome` page completes onboarding (client).

**Tech Stack:** Express + Pothos GraphQL + Prisma (SQLite) on the server, vitest + supertest; React 19 + Apollo Client 4 + react-jss on the client, vitest + Testing Library; graphql-codegen.

**Spec:** `docs/superpowers/specs/2026-10-13-register-with-email-onboarding-design.md`

## Global Constraints

- Email is **required when mail is configured** (`isMailConfigured(config) && mailer !== null`) and **rejected when it is not** (`EmailNotConfiguredError`); the client hides the field when `emailEnabled` is false.
- Accounts registered with an email are created with `passwordHash: null`, `mustChangePassword: false`, `emailVerifiedAt: null`.
- `ONBOARD_TTL_MS = 7 * 24 * 60 * 60 * 1000`.
- `/api/onboard` returns ONE 400 body for every rejected request: `{ error: 'That link is not valid or has expired.' }`.
- Minimum password length is 8 (`MIN_PASSWORD_LENGTH`, shared with `/api/password/reset`).
- Welcome link: `{publicUrl}/welcome?code={code}&email={email}` (both `encodeURIComponent`-encoded), present only when `publicUrl` is configured.
- No resend action in this pass.
- Server commands run from `app/server`; client from `app/client`; lint from the repo root (`npm run lint`) — it covers both workspaces.
- After any GraphQL schema change: `npm run graphql:schema` in `app/server`, then `npm run codegen` in `app/client`; commit `schema.generated.graphql`, `src/gql/*` and `persisted-documents.json` with the change.

## Review Focus

1. **Signed-in user follows a welcome link** (e.g. the admin testing on their own browser) — `UnprotectedRoute` redirects them home; the code is not consumed and stays valid for the intended user. Pinned in Task 5 (welcome page renders under the unprotected route only; no fetch fires on mount).
2. **No `publicUrl` configured** — the email carries only a code, so the user needs a way to reach `/welcome`. The login page gains a "Set up a new account" button when email is enabled (Task 5). *This is a gap the spec did not cover; the plan closes it.*
3. **Email typed with different case/whitespace than stored** (`Ann@Example.com ` vs `ann@example.com`) — `/api/onboard` looks up via `findUserByEmail` (normalized), and the code-address check compares against the row's stored `email`, which is exactly what the token recorded. Pinned in Task 3.
4. **Address already held by another user, including differing only by case** — register returns `EmailInUseError` and creates nothing (no row, and no library folder). Pinned in Task 2.
5. **Welcome send throttled or failing** — the account must still be usable: fallback password is returned, `mustChangePassword: true`, and the `onboard` token is gone so the link cannot also be used. Pinned in Task 2.

---

### Task 0: Commit the card rename and move

The working tree already holds the earlier, approved UI change (card titled "Register new user", rendered below the user list).

**Files:**
- Modify (already modified): `app/client/src/component/user-register/index.tsx`, `app/client/src/component/user-register/index.test.tsx`, `app/client/src/page/user-list/index.tsx`, `app/client/src/page/user-list/index.test.tsx`

- [ ] **Step 1: Verify the tests pass**

Run (in `app/client`): `npx vitest run src/page/user-list src/component/user-register`
Expected: 2 files, 8 tests pass.

- [ ] **Step 2: Commit**

```bash
git add app/client/src/component/user-register app/client/src/page/user-list
git commit -m "feat(client): retitle the register card and move it below the user list"
```

---

### Task 1: `onboard` token purpose and `welcomeMessage` template

**Files:**
- Modify: `app/server/services/email-token.ts`
- Modify: `app/server/services/mail-template.ts`
- Test: `app/server/services/email-token.test.ts`, `app/server/services/mail-template.test.ts`

**Interfaces:**
- Produces: `EmailTokenPurpose = 'verify' | 'reset' | 'onboard'`; `ONBOARD_TTL_MS: number`; `welcomeMessage(args: WelcomeArgs): MailMessage` where `WelcomeArgs = TemplateArgs & { username: string }`.

- [ ] **Step 1: Write the failing tests**

In `email-token.test.ts`, add `ONBOARD_TTL_MS` to the import from `./email-token`, and inside `describe('issueEmailToken', ...)` after the reset-TTL test:

```ts
  it('gives an onboard token the seven-day TTL', async () => {
    await issueEmailToken(prisma, { userId: 'u1', purpose: 'onboard', email: 'a@b.co', now: T0 });
    const row = await prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: 'u1', purpose: 'onboard' } },
    });
    expect(row.expiresAt).toBe(T0 + ONBOARD_TTL_MS);
    expect(ONBOARD_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
```

In `mail-template.test.ts`, add `welcomeMessage` to the import and append:

```ts
describe('welcomeMessage', () => {
  const WELCOME = { ...BASE, username: 'reader1' };

  it('names the library, the username and the code', () => {
    const message = welcomeMessage({ ...WELCOME, publicUrl: null });
    expect(message.subject).toBe('Your My Books account');
    expect(message.text).toContain('reader1');
    expect(message.text).toContain('K7M2QX4P');
    expect(message.html).toContain('K7M2QX4P');
    expect(message.to).toBe('reader@example.com');
  });

  it('omits any link when no public URL is configured', () => {
    const message = welcomeMessage({ ...WELCOME, publicUrl: null });
    expect(message.text).not.toContain('http');
    expect(message.html).not.toContain('href');
  });

  it('links to the welcome page carrying both the code and the address', () => {
    const message = welcomeMessage({ ...WELCOME, publicUrl: 'https://books.example.com' });
    const href = 'https://books.example.com/welcome?code=K7M2QX4P&email=reader%40example.com';
    expect(message.text).toContain(href);
    expect(message.html).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
  });

  it('says the code expires in 7 days and also confirms the address', () => {
    const { text } = welcomeMessage({ ...WELCOME, publicUrl: null });
    expect(text).toContain('7 days');
    expect(text).toMatch(/confirms this email address/);
  });

  it('escapes the library name and username in the html part', () => {
    const message = welcomeMessage({
      ...WELCOME,
      libraryName: '<b>Lib</b>',
      username: 'a<b',
      publicUrl: null,
    });
    expect(message.html).not.toContain('<b>Lib</b>');
    expect(message.html).toContain('&lt;b&gt;Lib&lt;/b&gt;');
    expect(message.html).toContain('a&lt;b');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `app/server`): `npx vitest run services/email-token.test.ts services/mail-template.test.ts`
Expected: FAIL — `ONBOARD_TTL_MS` / `welcomeMessage` not exported; `'onboard'` not assignable to `EmailTokenPurpose`.

- [ ] **Step 3: Implement**

`email-token.ts` — widen the type, add the constant, extend `ttlFor`, and update the module doc's first line to mention onboarding:

```ts
/**
 * Single-use codes for confirming an address, resetting a password, and
 * onboarding a newly registered account.
 ...
 */
export type EmailTokenPurpose = 'verify' | 'reset' | 'onboard';

/**
 * 7 days for onboarding: a new user may not check that inbox for a while, and
 * the token only works on an account that has never had a password
 * (`/api/onboard` refuses any row with a `passwordHash`).
 */
export const ONBOARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ttlFor(purpose: EmailTokenPurpose): number {
  if (purpose === 'verify') return VERIFY_TTL_MS;
  if (purpose === 'onboard') return ONBOARD_TTL_MS;
  return RESET_TTL_MS;
}
```

`mail-template.ts` — add after `passwordResetMessage`, and update the module doc comment to say "the three code-bearing messages (`verificationMessage`, `passwordResetMessage`, `welcomeMessage`)" and "All six":

```ts
export type WelcomeArgs = TemplateArgs & { username: string };

/**
 * The link carries the address as well as the code because `EmailToken` is
 * keyed by account, not by hash — `/api/onboard` has to be told which account
 * the code belongs to, exactly as `/api/password/reset` is.
 */
export function welcomeMessage(args: WelcomeArgs): MailMessage {
  return render({
    to: args.to,
    subject: `Your ${args.libraryName} account`,
    lead:
      `An account has been created for you on ${args.libraryName}. Your username is ` +
      `${args.username}. Enter this code in ${args.libraryName} to choose your password:`,
    code: args.code,
    href:
      args.publicUrl === null
        ? null
        : `${args.publicUrl}/welcome?code=${encodeURIComponent(args.code)}` +
          `&email=${encodeURIComponent(args.to)}`,
    linkLabel: 'Or set up your account here',
    closing:
      'This code expires in 7 days and can be used once. Using it also confirms this email address.',
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run services/email-token.test.ts services/mail-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/services/email-token.ts app/server/services/mail-template.ts app/server/services/email-token.test.ts app/server/services/mail-template.test.ts
git commit -m "feat(server): add the onboard email token and the welcome message"
```

---

### Task 2: `userRegister` takes an email and sends the welcome mail

**Files:**
- Modify: `app/server/services/user.ts:16-40` (`createUser`)
- Modify: `app/server/graphql/schema/user/mutation/register.ts`
- Regenerate: `app/server/graphql/schema.generated.graphql`
- Test: `app/server/graphql/schema/user/mutation/register.test.ts`

**Interfaces:**
- Consumes: `issueEmailToken`, `invalidateEmailTokens` (`services/email-token`), `welcomeMessage` (Task 1), `isValidEmail`, `normalizeEmail`, `findUserByEmail` (`services/email`), `emailInUseError()`, `emailNotConfiguredError()`, `invalidInputIssue(path, message)`.
- Produces: `createUser(prisma, username, passwordHash, syncPassword?, mustChangePassword?, options?: { email?: string }): Promise<boolean>`; GraphQL `UserRegisterInput.email: String`, `UserRegisterPayload.password: String` (nullable), `UserRegisterPayload.onboardingEmailSent: Boolean!`, `UserRegisterResult` adds `EmailInUseError | EmailNotConfiguredError`.

- [ ] **Step 1: Write the failing tests**

In `register.test.ts`: change the imports to

```ts
import { createHarness, MAIL_CONFIG, type Harness } from '../../../test-util';
```

and replace `MUTATION` with:

```ts
const MUTATION = `
  mutation Register($input: UserRegisterInput!) {
    userRegister(input: $input) {
      __typename
      ... on UserRegisterPayload {
        user { username mustChangePassword }
        password
        onboardingEmailSent
      }
      ... on InvalidInputError {
        message
        issues { path message }
      }
      ... on UsernameAlreadyExistsError {
        message
        username
      }
      ... on EmailInUseError {
        message
      }
      ... on EmailNotConfiguredError {
        message
      }
    }
  }
`;
```

The existing tests use `beforeEach(createHarness())` (mail unconfigured) — keep it. Add `onboardingEmailSent: false` to the first test's `toMatchObject`. Then append two describes. The second needs its own harness with mail, so it re-creates `harness` (the shared `afterEach` cleans up whichever is current; clean the default one first):

```ts
describe('Mutation.userRegister — mail not configured', () => {
  it('rejects an email with EmailNotConfiguredError and creates nothing', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'c@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({ __typename: 'EmailNotConfiguredError' });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
  });
});

describe('Mutation.userRegister — mail configured', () => {
  beforeEach(async () => {
    await harness.cleanup();
    harness = await createHarness({ mail: MAIL_CONFIG });
  });

  it('requires an email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['email'], message: 'Email is required' }],
    });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
  });

  it('rejects an implausible email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'not-an-address' } },
    });

    expect(result.data?.userRegister).toEqual({
      __typename: 'InvalidInputError',
      message: 'Invalid input',
      issues: [{ path: ['email'], message: 'Enter a valid email address' }],
    });
  });

  it('still checks the username before the email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'abc', email: 'not-an-address' } },
    });

    expect(result.data?.userRegister).toMatchObject({
      __typename: 'InvalidInputError',
      issues: [{ path: ['username'] }],
    });
  });

  it('creates a password-less account with the address and sends the welcome email', async () => {
    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: ' Charlie@Example.com ' } },
    });

    expect(result.errors).toBeUndefined();
    expect(result.data?.userRegister).toEqual({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie1', mustChangePassword: false },
      password: null,
      onboardingEmailSent: true,
    });

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { username: 'charlie1' } });
    expect(row.passwordHash).toBeNull();
    expect(row.email).toBe('Charlie@Example.com');
    expect(row.emailKey).toBe('charlie@example.com');
    expect(row.emailVerifiedAt).toBeNull();

    const token = await harness.prisma.emailToken.findUniqueOrThrow({
      where: { userId_purpose: { userId: row.id, purpose: 'onboard' } },
    });
    expect(token.email).toBe('Charlie@Example.com');

    expect(harness.mailer!.sent).toHaveLength(1);
    expect(harness.mailer!.sent[0].to).toBe('Charlie@Example.com');
    expect(harness.mailer!.sent[0].text).toContain('charlie1');
  });

  it('returns EmailInUseError for an address another user holds, differing only by case, and creates nothing', async () => {
    await harness.prisma.user.update({
      where: { id: harness.aliceOwner.userId },
      data: { email: 'taken@example.com', emailKey: 'taken@example.com' },
    });

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'TAKEN@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({ __typename: 'EmailInUseError' });
    expect(await harness.prisma.user.findUnique({ where: { username: 'charlie1' } })).toBeNull();
    expect(fs.existsSync(path.join(harness.config.booksDir, 'charlie1'))).toBe(false);
    expect(harness.mailer!.sent).toHaveLength(0);
  });

  it('falls back to a generated password when the welcome email fails to send', async () => {
    harness.mailer!.nextResult = { ok: false, reason: 'transient' };

    const result = await harness.execute(MUTATION, {
      viewer: harness.adminViewer,
      variables: { input: { username: 'charlie1', email: 'c@example.com' } },
    });

    expect(result.data?.userRegister).toMatchObject({
      __typename: 'UserRegisterPayload',
      user: { username: 'charlie1', mustChangePassword: true },
      onboardingEmailSent: false,
    });
    const { password } = result.data?.userRegister as { password: string };
    expect(typeof password).toBe('string');

    const row = await harness.prisma.user.findUniqueOrThrow({ where: { username: 'charlie1' } });
    expect(await validateUser(harness.prisma, 'charlie1', password)).toBe(row.id);
    expect(row.email).toBe('c@example.com');
    expect(
      await harness.prisma.emailToken.findUnique({
        where: { userId_purpose: { userId: row.id, purpose: 'onboard' } },
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `app/server`): `npx vitest run graphql/schema/user/mutation/register.test.ts`
Expected: FAIL — the query does not validate (`onboardingEmailSent`, `email` input field, and the two error types are not in the schema).

- [ ] **Step 3: Extend `createUser`**

In `services/user.ts`, add `import { normalizeEmail } from './email';` and change the function to:

```ts
export async function createUser(
  prisma: PrismaClient,
  username: string,
  passwordHash: string | null,
  syncPassword?: string,
  mustChangePassword?: boolean,
  options: { email?: string } = {}
): Promise<boolean> {
  try {
    await prisma.user.create({
      data: {
        id: generateUserId(),
        username,
        passwordHash,
        syncPassword: syncPassword ?? generateSyncPassword(),
        mustChangePassword: mustChangePassword ?? false,
        ...(options.email === undefined
          ? {}
          : { email: options.email, emailKey: normalizeEmail(options.email) }),
      },
    });
    return true;
  } catch (e) {
    // `P2002` now covers either unique index (`username` or `email_key`); the
    // caller re-queries to tell which, since `e.meta.target` is not reliable
    // under driver adapters.
    if (isPrismaError(e, 'P2002')) {
      return false;
    }
    throw e;
  }
}
```

- [ ] **Step 4: Rewrite the `userRegister` resolver**

In `register.ts`, add imports:

```ts
import { findUserByEmail, isValidEmail } from '../../../../services/email';
import { invalidateEmailTokens, issueEmailToken } from '../../../../services/email-token';
import { welcomeMessage } from '../../../../services/mail-template';
import { isMailConfigured } from '../../../../services/mailer';
import { emailInUseError, model as emailInUseErrorModel } from '../../email-in-use-error/model';
import {
  emailNotConfiguredError,
  model as emailNotConfiguredErrorModel,
} from '../../email-not-configured-error/model';
```

and add `invalidInputIssue` to the existing `invalid-input-error/model` import.

Input (update its doc comment: "`username`, plus `email` — required when mail is configured, rejected when it is not; optional in the schema only because which rule applies depends on the install"):

```ts
const input = builder.inputType('UserRegisterInput', {
  fields: (t) => ({
    username: t.string({ required: true }),
    email: t.string({ required: false }),
  }),
});
```

Payload:

```ts
type UserRegisterPayloadShape = {
  readonly __typename: 'UserRegisterPayload';
  readonly username: string;
  readonly password: string | null;
  readonly onboardingEmailSent: boolean;
};

const payload = builder.objectRef<UserRegisterPayloadShape>('UserRegisterPayload').implement({
  fields: (t) => ({
    user: t.prismaField({ /* unchanged */ }),
    /**
     * Null when the welcome email went out: the account then has no password
     * at all, and the onboarding link is the only way in.
     */
    password: t.exposeString('password', { nullable: true }),
    onboardingEmailSent: t.exposeBoolean('onboardingEmailSent'),
  }),
});

const result = builder.unionType('UserRegisterResult', {
  types: [
    payload,
    invalidInputErrorModel,
    usernameAlreadyExistsErrorModel,
    emailInUseErrorModel,
    emailNotConfiguredErrorModel,
  ],
});
```

Resolver body — keep the charset, reserved-name and length checks exactly as they are, then replace everything from `fs.mkdirSync` onward with:

```ts
      // Email rules depend on the install, not the admin: an install that can
      // send mail onboards every new account by mail; one that cannot keeps the
      // generated-password hand-off. Checked after every username rule so the
      // existing username error ordering is unchanged.
      const mailer = isMailConfigured(context.config) ? context.mailer : null;
      const rawEmail = args.input.email?.trim() ?? '';
      if (mailer === null && rawEmail !== '') return emailNotConfiguredError();
      if (mailer !== null) {
        if (rawEmail === '') return invalidInputIssue(['email'], 'Email is required');
        if (!isValidEmail(rawEmail)) {
          return invalidInputIssue(['email'], 'Enter a valid email address');
        }
        // Pre-checked so a taken address creates neither a row nor a library
        // folder. The P2002 branch below still covers the race.
        if ((await findUserByEmail(context.prisma, rawEmail)) !== null) return emailInUseError();
      }

      fs.mkdirSync(path.join(context.config.booksDir, username), { recursive: true });

      if (mailer === null) {
        const password = generateLoginPassword();
        const passwordHash = await hashLoginPassword(password);
        const created = await createUser(context.prisma, username, passwordHash, undefined, true);
        if (!created) return usernameAlreadyExistsError(username);
        return {
          __typename: 'UserRegisterPayload' as const,
          username,
          password,
          onboardingEmailSent: false,
        };
      }

      const created = await createUser(context.prisma, username, null, undefined, false, {
        email: rawEmail,
      });
      if (!created) {
        const taken = await context.prisma.user.findUnique({
          where: { username },
          select: { id: true },
        });
        return taken ? usernameAlreadyExistsError(username) : emailInUseError();
      }
      const { id: userId } = await context.prisma.user.findUniqueOrThrow({
        where: { username },
        select: { id: true },
      });

      const issued = await issueEmailToken(context.prisma, {
        userId,
        purpose: 'onboard',
        email: rawEmail,
      });
      const sent =
        issued.ok &&
        (
          await mailer.send(
            welcomeMessage({
              to: rawEmail,
              code: issued.code,
              username,
              libraryName: context.config.libraryName,
              publicUrl: context.config.publicUrl ?? null,
            })
          )
        ).ok;
      if (sent) {
        return {
          __typename: 'UserRegisterPayload' as const,
          username,
          password: null,
          onboardingEmailSent: true,
        };
      }

      // The welcome email did not go out, so nobody holds the code: fall back to
      // today's hand-off rather than leave an account nobody can enter, and drop
      // the token so the account does not end up with two ways in.
      await invalidateEmailTokens(context.prisma, userId, 'onboard');
      const password = generateLoginPassword();
      await context.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashLoginPassword(password), mustChangePassword: true },
      });
      return {
        __typename: 'UserRegisterPayload' as const,
        username,
        password,
        onboardingEmailSent: false,
      };
```

Update the resolver's doc comment: after the four-check list add "5. email (mail configured only) — required, plausible, not already held (`EmailInUseError`); a supplied email on an install without mail is `EmailNotConfiguredError`." and a paragraph describing the password-less path and the send-failure fallback (D3/D4 of the spec).

- [ ] **Step 5: Regenerate the schema and run tests**

Run (in `app/server`): `npm run graphql:schema && npx vitest run graphql/schema/user/mutation/register.test.ts services/user`
Expected: PASS.

- [ ] **Step 6: Run the full server suite**

Run: `npm test`
Expected: PASS. If a cost/operations test snapshots the schema or the client documents, it will be refreshed in Task 4 (client codegen) — note any such failure and re-run there.

- [ ] **Step 7: Commit**

```bash
git add app/server/services/user.ts app/server/graphql/schema/user/mutation/register.ts app/server/graphql/schema/user/mutation/register.test.ts app/server/graphql/schema.generated.graphql
git commit -m "feat(server): register a user with an email and send a welcome email"
```

---

### Task 3: `POST /api/onboard`

**Files:**
- Modify: `app/server/routes/password.ts:40` (export `MIN_PASSWORD_LENGTH`)
- Modify: `app/server/routes/ui.ts` (new route, directly after `router.use(createPasswordRouter(...))` and before `router.use(passwordChangeGate(...))`)
- Test: `app/server/routes/password.test.ts` (new `describe` at the end — it already builds the full `createUiRouter` with an optional `FakeMailer`)

**Interfaces:**
- Consumes: `findUserByEmail`, `consumeEmailToken`, `invalidateEmailTokens`, `hashLoginPassword`, `issueTokens` (closure in `createUiRouter`), `passwordRateLimit` (same closure), `deleteExpired`.
- Produces: `POST /api/onboard` body `{ email: string, code: string, newPassword: string }` → `200 { accessToken }` + `refresh_token` cookie | `400 { error: 'That link is not valid or has expired.' }` | `404` (mail off) | `429` (rate limit).

- [ ] **Step 1: Write the failing tests**

Append to `routes/password.test.ts` (add `issueEmailToken` and `ONBOARD_TTL_MS` to the `../services/email-token` import, and `verifyAccessToken` from `../services/jwt`):

```ts
describe('POST /api/onboard', () => {
  const ERROR = { error: 'That link is not valid or has expired.' };

  /** A freshly registered, password-less account with an outstanding onboard code. */
  const primed = async (now?: number) => {
    const built = build({ mail: MAIL_CONFIG });
    await createUser(prisma, 'newbie1', null, undefined, false, { email: 'New@Example.com' });
    const { id } = await prisma.user.findUniqueOrThrow({ where: { username: 'newbie1' } });
    const issued = await issueEmailToken(prisma, {
      userId: id,
      purpose: 'onboard',
      email: 'New@Example.com',
      now,
    });
    const code = (issued as { ok: true; code: string }).code;
    return { ...built, id, code };
  };

  it('sets the password, verifies the address and signs the user in', async () => {
    const { app, id, code } = await primed();

    const res = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code, newPassword: 'chosen-password' });

    expect(res.status).toBe(200);
    const claims = verifyAccessToken(jwtSecret, res.body.accessToken);
    expect(claims).toMatchObject({ username: 'newbie1', isAdmin: false, mustChangePassword: false });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^refresh_token=/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.mustChangePassword).toBe(false);
    const login = await request(app)
      .post('/api/login')
      .send({ username: 'newbie1', password: 'chosen-password' });
    expect(login.status).toBe(200);
  });

  it('accepts the address with different case and surrounding whitespace', async () => {
    const { app, code } = await primed();
    const res = await request(app)
      .post('/api/onboard')
      .send({ email: '  NEW@example.COM ', code, newPassword: 'chosen-password' });
    expect(res.status).toBe(200);
  });

  it('consumes the code', async () => {
    const { app, code } = await primed();
    const body = { email: 'new@example.com', code, newPassword: 'chosen-password' };
    expect((await request(app).post('/api/onboard').send(body)).status).toBe(200);
    const again = await request(app).post('/api/onboard').send(body);
    expect(again.status).toBe(400);
    expect(again.body).toEqual(ERROR);
  });

  it('rejects a wrong code without burning the right one', async () => {
    const { app, code } = await primed();
    const wrong = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code: 'AAAAAAAA', newPassword: 'chosen-password' });
    expect(wrong.status).toBe(400);
    expect(wrong.body).toEqual(ERROR);
    const right = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code, newPassword: 'chosen-password' });
    expect(right.status).toBe(200);
  });

  it('rejects an expired code', async () => {
    const { app, code } = await primed(Date.now() - ONBOARD_TTL_MS - 1000);
    const res = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code, newPassword: 'chosen-password' });
    expect(res.status).toBe(400);
  });

  it('rejects a too-short password without burning the code', async () => {
    const { app, code } = await primed();
    const short = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body).toEqual(ERROR);
    const ok = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code, newPassword: 'chosen-password' });
    expect(ok.status).toBe(200);
  });

  it('refuses an account that already has a password', async () => {
    const { app, id, code } = await primed();
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashLoginPassword('existing-password') },
    });
    const res = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code, newPassword: 'chosen-password' });
    expect(res.status).toBe(400);
  });

  it('refuses a code issued for a different address', async () => {
    const { app, id, code } = await primed();
    await prisma.user.update({
      where: { id },
      data: { email: 'moved@example.com', emailKey: 'moved@example.com' },
    });
    const res = await request(app)
      .post('/api/onboard')
      .send({ email: 'moved@example.com', code, newPassword: 'chosen-password' });
    expect(res.status).toBe(400);
  });

  it('refuses the config admin row', async () => {
    const { app } = build({ mail: MAIL_CONFIG });
    const adminId = (await ensureAdminUser(prisma, config.username))!;
    await prisma.user.update({
      where: { id: adminId },
      data: { email: 'admin@example.com', emailKey: 'admin@example.com' },
    });
    const issued = await issueEmailToken(prisma, {
      userId: adminId,
      purpose: 'onboard',
      email: 'admin@example.com',
    });
    const res = await request(app).post('/api/onboard').send({
      email: 'admin@example.com',
      code: (issued as { ok: true; code: string }).code,
      newPassword: 'chosen-password',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed body', async () => {
    const { app } = await primed();
    const res = await request(app).post('/api/onboard').send({ email: 'new@example.com' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(ERROR);
  });

  it('does not exist when mail is not configured', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/api/onboard')
      .send({ email: 'new@example.com', code: 'AAAAAAAA', newPassword: 'chosen-password' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `app/server`): `npx vitest run routes/password.test.ts -t "api/onboard"`
Expected: FAIL — 404 for every request (route does not exist).

- [ ] **Step 3: Implement**

`routes/password.ts`: `export const MIN_PASSWORD_LENGTH = 8;`

`routes/ui.ts`: extend imports — `consumeEmailToken, invalidateEmailTokens` from `../services/email-token`; `hashLoginPassword` from `../services/password`; `MIN_PASSWORD_LENGTH` alongside `createPasswordRouter` from `./password`. Then, immediately after `router.use(createPasswordRouter(...))`:

```ts
  // Onboarding: a newly registered account (created password-less by
  // `userRegister` when mail is configured) chooses its password with the code
  // from its welcome email. Here rather than in `routes/password.ts` because it
  // ends in a sign-in, and `issueTokens` is this router's closure. Shares the
  // reset limiter: same shape of request, same cost of a wrong guess.
  router.post(
    '/api/onboard',
    passwordRateLimit,
    asyncHandler(async (req: Request, res: Response) => {
      if (!isMailConfigured(config) || mailer === null) {
        res.sendStatus(404);
        return;
      }
      const { email, code, newPassword } = req.body as {
        email?: unknown;
        code?: unknown;
        newPassword?: unknown;
      };
      // One 400 for every failure, as `/api/password/reset` does: the user's
      // next step is the same in all of them (ask the admin), and a distinct
      // answer would tell a guesser which part of the guess landed.
      const reject = (reason: string): void => {
        log.warn(`Onboarding rejected — ${reason}`);
        res.status(400).json({ error: 'That link is not valid or has expired.' });
      };

      if (
        typeof email !== 'string' ||
        typeof code !== 'string' ||
        typeof newPassword !== 'string'
      ) {
        reject('malformed body');
        return;
      }
      // Before any token lookup, so a too-short password never burns a code.
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        reject('new password too short');
        return;
      }
      const account = await findUserByEmail(prisma, email);
      if (account === null || account.isConfigAdmin) {
        reject('no eligible account for that address');
        return;
      }
      // Onboarding only ever SETS a first password. An account that already has
      // one goes through reset, which revokes sessions — this path does not.
      const { passwordHash } = await prisma.user.findUniqueOrThrow({
        where: { id: account.id },
        select: { passwordHash: true },
      });
      if (passwordHash !== null) {
        reject('account already has a password');
        return;
      }
      const consumed = await consumeEmailToken(prisma, {
        userId: account.id,
        purpose: 'onboard',
        code,
      });
      if (consumed === null) {
        reject('unknown, used or expired code');
        return;
      }
      if (account.email === null || consumed.email !== account.email) {
        reject('code was issued for a different address');
        return;
      }

      // The code arrived at this address, which is exactly what `verify`
      // proves, so the address is confirmed in the same write. No refresh
      // tokens to revoke: a password-less account has never been able to sign in.
      await prisma.user.update({
        where: { id: account.id },
        data: {
          passwordHash: await hashLoginPassword(newPassword),
          emailVerifiedAt: Date.now(),
          mustChangePassword: false,
        },
      });
      await invalidateEmailTokens(prisma, account.id, 'onboard');
      log.info(`Onboarding completed for "${account.username}"`);
      await deleteExpired(prisma);
      await issueTokens(res, {
        userId: account.id,
        username: account.username,
        isAdmin: false,
        mustChangePassword: false,
        mustSetEmail: false,
      });
    })
  );
```

(`log` is `routes/ui.ts`'s existing `const log = logger('UI')`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run routes/password.test.ts`
Expected: PASS (existing forgot/reset tests included).

- [ ] **Step 5: Commit**

```bash
git add app/server/routes/password.ts app/server/routes/ui.ts app/server/routes/password.test.ts
git commit -m "feat(server): add POST /api/onboard to set a first password from a welcome code"
```

---

### Task 4: Register card — Email field and result modals

**Files:**
- Modify: `app/client/src/graphql/user.ts:91-116` (`UserRegisterDocument`)
- Regenerate: `app/client/src/gql/*`, `app/client/src/gql/persisted-documents.json`
- Modify: `app/client/src/control/confirm-modal/index.tsx` (add `hideCancel`)
- Modify: `app/client/src/control/password-result-modal/index.tsx` (add `notice`)
- Modify: `app/client/src/component/user-register/index.tsx`
- Test: `app/client/src/component/user-register/index.test.tsx`

**Interfaces:**
- Consumes: GraphQL from Task 2; `useEmailEnabled()` and `ConfigContext` from `~/provider/config`.
- Produces: `ConfirmModal` prop `hideCancel?: boolean`; `PasswordResultModal` prop `notice?: string`.

- [ ] **Step 1: Update the document and regenerate**

In `UserRegisterDocument`, add `onboardingEmailSent` after `password`, and add:

```graphql
      ... on EmailInUseError {
        message
      }
      ... on EmailNotConfiguredError {
        message
      }
```

Run (in `app/client`): `npm run codegen`
Expected: `src/gql/graphql.ts`, `src/gql/gql.ts` and `persisted-documents.json` update; `UserRegisterInput` has `email?: InputMaybe<string>`.

- [ ] **Step 2: Write the failing tests**

In `component/user-register/index.test.tsx`:

- Import `ConfigContext` from `~/provider/config` and `type ReactElement` from `react`.
- Make the mocks take an optional email and the new field:

```ts
const registerSuccessMock = (
  username: string,
  password: string | null,
  { email, onboardingEmailSent = false }: { email?: string; onboardingEmailSent?: boolean } = {}
): MockedResponse<UserRegisterMutation, UserRegisterMutationVariables> => ({
  request: {
    query: UserRegisterDocument,
    variables: { input: email === undefined ? { username } : { username, email } },
  },
  result: {
    data: {
      __typename: 'Mutation',
      userRegister: {
        __typename: 'UserRegisterPayload',
        user: {
          __typename: 'User',
          id: 'u-new',
          username,
          pendingBookRequestCount: 0,
          email: email ?? null,
          emailVerifiedAt: null,
          library: { __typename: 'Library', id: 'lib-new' },
        },
        password,
        onboardingEmailSent,
      },
    },
  },
});
```

- Replace `renderForm` so it can vary `emailEnabled` (same pattern as `component/user-row/index.test.tsx`), defaulting to `false` so every existing test keeps its current behaviour:

```ts
function renderForm(mocks: MockedResponse[] = [], { emailEnabled = false } = {}) {
  const rendered = renderWithApollo(
    <ConfigContext.Provider value={{ libraryName: 'Bookplate', emailEnabled }}>
      <UserRegister />
    </ConfigContext.Provider>,
    { mocks }
  );
  seedEmptyUserList(rendered.client);
  const usernameInput = rendered.container.querySelector(
    'input[name="username"]'
  ) as HTMLInputElement;
  const emailInput = rendered.container.querySelector(
    'input[name="email"]'
  ) as HTMLInputElement | null;
  return { ...rendered, usernameInput, emailInput };
}
```

Then add:

```ts
// The server's uniform `emailInUseError()` message, verbatim.
const EMAIL_IN_USE =
  'That email address is already in use by another account. Ask your administrator if you think it should be yours.';

describe('UserRegister — email', () => {
  it('shows no email field when email is not enabled', () => {
    const { emailInput } = renderForm([], { emailEnabled: false });
    expect(emailInput).toBeNull();
  });

  it('keeps Register disabled until both username and email are valid', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm([], { emailEnabled: true });
    const button = screen.getByRole('button', { name: 'Register' });

    await user.type(usernameInput, 'charlie1');
    expect(button).toBeDisabled();
    await user.type(emailInput!, 'not-an-address');
    expect(button).toBeDisabled();
    await user.clear(emailInput!);
    await user.type(emailInput!, 'c@example.com');
    expect(button).toBeEnabled();
  });

  it('sends the email and confirms the welcome email went out', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm(
      [registerSuccessMock('charlie1', null, { email: 'c@example.com', onboardingEmailSent: true })],
      { emailEnabled: true }
    );

    await user.type(usernameInput, 'charlie1');
    await user.type(emailInput!, 'c@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/welcome email sent to c@example\.com/i)).toBeInTheDocument();
    expect(screen.queryByText(/new password for/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('falls back to the password modal, with a note, when the welcome email did not send', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm(
      [registerSuccessMock('charlie1', 'Gen3rated!', { email: 'c@example.com' })],
      { emailEnabled: true }
    );

    await user.type(usernameInput, 'charlie1');
    await user.type(emailInput!, 'c@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText(/new password for charlie1/i)).toBeInTheDocument();
    expect(screen.getByText(/welcome email could not be sent/i)).toBeInTheDocument();
  });

  it('toasts EmailInUseError and keeps the form values', async () => {
    const user = userEvent.setup();
    const { usernameInput, emailInput } = renderForm(
      [
        {
          request: {
            query: UserRegisterDocument,
            variables: { input: { username: 'charlie1', email: 'c@example.com' } },
          },
          result: {
            data: {
              __typename: 'Mutation',
              userRegister: {
                __typename: 'EmailInUseError',
                message: EMAIL_IN_USE,
              },
            },
          },
        },
      ],
      { emailEnabled: true }
    );

    await user.type(usernameInput, 'charlie1');
    await user.type(emailInput!, 'c@example.com');
    await user.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByRole('status')).toHaveTextContent(EMAIL_IN_USE);
    expect(usernameInput.value).toBe('charlie1');
    expect(emailInput!.value).toBe('c@example.com');
  });
});
```

This mirrors the existing `conflictMock` test, which asserts its toast via `findByRole('status')`.

- [ ] **Step 3: Run tests to verify they fail**

Run (in `app/client`): `npx vitest run src/component/user-register`
Expected: FAIL — no `email` input, no welcome-sent text, no notice.

- [ ] **Step 4: Add `hideCancel` to `ConfirmModal`**

Add `hideCancel?: boolean;` to `ConfirmModalProps`, default `hideCancel = false` in the destructure, and wrap the cancel button:

```tsx
          {hideCancel ? null : (
            <Button onClick={handleCancel} disabled={loading} type="text" radius="modal">
              {cancelText}
            </Button>
          )}
```

- [ ] **Step 5: Add `notice` to `PasswordResultModal`**

Add `notice?: string;` to `PasswordResultModalProps`, destructure it, and render it in the body directly after the existing `<p>`:

```tsx
          {notice ? <p>{notice}</p> : null}
```

- [ ] **Step 6: Update `UserRegister`**

Add imports: `ConfirmModal` from `~/control`; `useEmailEnabled` from `~/provider/config`. Add a local plausibility check mirroring the server's typo filter:

```ts
// A typo filter, not a security boundary — the server's `isValidEmail` decides.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
```

State:

```ts
  const emailEnabled = useEmailEnabled();
  const [email, setEmail] = useState<string>('');
  const [isEmailValid, setIsEmailValid] = useState<boolean>(false);
  const [result, setResult] = useState<
    | { kind: 'password'; username: string; password: string; notice?: string }
    | { kind: 'welcome'; username: string; email: string }
    | null
  >(null);
```

Mutation variables:

```ts
        variables: { input: emailEnabled ? { username, email: email.trim() } : { username } },
```

Success handling (replace the `setResult({ username, password: ... })` line):

```ts
      const { password, onboardingEmailSent } = registerResult.payload;
      if (onboardingEmailSent) {
        setResult({ kind: 'welcome', username, email: email.trim() });
      } else if (password !== null) {
        setResult({
          kind: 'password',
          username,
          password,
          notice: emailEnabled
            ? 'The welcome email could not be sent, so share this password with them instead.'
            : undefined,
        });
      } else {
        showToast('Registration failed', 'error');
        return null;
      }
      setUsername('');
      setIsUsernameValid(false);
      setEmail('');
      setIsEmailValid(false);
```

Callbacks:

```ts
  const handleEmailChange = useCallback((newValue: string | undefined) => {
    setEmail(newValue ?? '');
  }, []);

  const validateEmail = useCallback((newValue: string): boolean => {
    const valid = EMAIL_PATTERN.test(newValue.trim());
    setIsEmailValid(valid);
    return valid;
  }, []);
```

Form — add under the username `TextInput`, inside `inputContainer`:

```tsx
            {emailEnabled ? (
              <TextInput
                name="email"
                value={email}
                onChange={handleEmailChange}
                validate={validateEmail}
                layout="horizontal"
                label="Email"
                autoCapitalize="none"
                autoComplete="off"
              />
            ) : null}
```

Button: `disabled={!isUsernameValid || (emailEnabled && !isEmailValid)}`.

Modals (replace the single `PasswordResultModal`):

```tsx
      <PasswordResultModal
        isOpen={result?.kind === 'password'}
        username={result?.username ?? ''}
        password={result?.kind === 'password' ? result.password : null}
        notice={result?.kind === 'password' ? result.notice : undefined}
        onDone={handleDone}
      />
      <ConfirmModal
        isOpen={result?.kind === 'welcome'}
        title="User registered"
        confirmText="Done"
        hideCancel
        onConfirm={handleDone}
        onCancel={handleDone}
      >
        {result?.kind === 'welcome'
          ? `Welcome email sent to ${result.email}. ${result.username} can set their password from the link.`
          : null}
      </ConfirmModal>
```

Note: the `TextInput` has no `type` prop, so the spec's `type="email"` becomes `autoCapitalize="none"`.

Update the component's doc comment with one paragraph on the email field (shown only when `emailEnabled`; the server enforces the same rule) and the two result modals.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/component/user-register src/control/confirm-modal src/control/password-result-modal src/page/user-list`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/client/src/graphql/user.ts app/client/src/gql app/client/src/control/confirm-modal app/client/src/control/password-result-modal app/client/src/component/user-register
git commit -m "feat(client): add an email field to the register card and confirm the welcome email"
```

---

### Task 5: Welcome page and the login-page entry point

**Files:**
- Modify: `app/client/src/router/path-internal.ts`, `app/client/src/router/path.ts` (add `welcome`)
- Create: `app/client/src/page/welcome/index.tsx`, `app/client/src/page/welcome/style.ts`, `app/client/src/page/welcome/index.test.tsx`
- Modify: `app/client/src/page/index.ts` (export `WelcomePage`)
- Modify: `app/client/src/router/component.tsx` (route under `UnprotectedRoute`)
- Modify: `app/client/src/page/login/index.tsx`, `app/client/src/page/login/index.test.tsx`

**Interfaces:**
- Consumes: `POST /api/onboard` (Task 3); `extractAccessToken`, `setToken` from `~/lib/token`.
- Produces: `path.welcome(): '/welcome'`; `WelcomePage`.

- [ ] **Step 1: Write the failing tests**

`page/welcome/index.test.tsx` (modelled on `page/reset-password/index.test.tsx`):

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '~/test-utils';

import { WelcomePage } from './index';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setToken: vi.fn(),
  search: '',
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.search)],
}));
vi.mock('~/lib/token', async (orig) => ({
  ...(await orig<typeof import('~/lib/token')>()),
  setToken: mocks.setToken,
}));

const fill = async (user: ReturnType<typeof userEvent.setup>, password = 'chosen-password') => {
  await user.type(screen.getByPlaceholderText('New password'), password);
  await user.type(screen.getByPlaceholderText('Confirm new password'), password);
};

describe('WelcomePage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.navigate.mockReset();
    mocks.setToken.mockReset();
    mocks.search = '';
  });

  it('prefills the address and code from the link and fires no request on mount', () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<WelcomePage />);

    expect(screen.getByPlaceholderText('Email address')).toHaveValue('new@example.com');
    expect(screen.getByPlaceholderText('Welcome code')).toHaveValue('K7M2QX4P');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits to /api/onboard and stores the returned token', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: 'a.b.c' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<WelcomePage />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/onboard',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'new@example.com',
          code: 'K7M2QX4P',
          newPassword: 'chosen-password',
        }),
      })
    );
    expect(mocks.setToken).toHaveBeenCalledWith('a.b.c');
  });

  it('refuses mismatched passwords without a request', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<WelcomePage />);

    await user.type(screen.getByPlaceholderText('New password'), 'chosen-password');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'different-password');
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Those passwords do not match')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message on 400 and points to the admin, not forgot-password', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'That link is not valid or has expired.' }),
      })
    );
    renderWithProviders(<WelcomePage />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(
      await screen.findByText(/That link is not valid or has expired\. Ask your library admin/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /forgot/i })).toBeNull();
    expect(mocks.setToken).not.toHaveBeenCalled();
  });

  it('reports a rate limit with the retry delay', async () => {
    mocks.search = 'code=K7M2QX4P&email=new%40example.com';
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '30' }),
      })
    );
    renderWithProviders(<WelcomePage />);

    await fill(user);
    await user.click(screen.getByRole('button', { name: /set password/i }));

    expect(await screen.findByText('Too many attempts — try again in 30 seconds')).toBeInTheDocument();
  });

  it('offers a back-to-sign-in button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WelcomePage />);
    await user.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });
});
```

In `page/login/index.test.tsx`, add beside the forgot-password tests:

```tsx
  it('offers a set-up-account button that goes to the welcome page when email is enabled', async () => {
    const user = userEvent.setup();
    renderWithConfig(<LoginPage />, { emailEnabled: true });

    const button = screen.getByRole('button', { name: /set up a new account/i });
    expect(button.closest('form')).toBeNull();
    await user.click(button);
    expect(routerMocks.navigate).toHaveBeenCalledWith('/welcome');
  });

  it('offers no set-up-account button when email is disabled', () => {
    renderWithConfig(<LoginPage />, { emailEnabled: false });
    expect(screen.queryByRole('button', { name: /set up a new account/i })).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `app/client`): `npx vitest run src/page/welcome src/page/login`
Expected: FAIL — `./index` not found; no set-up-account button.

- [ ] **Step 3: Add the path**

`router/path-internal.ts`: `export const welcome = () => '/welcome';`
`router/path.ts`: `export const welcome = () => pathInternal.welcome();` (alphabetical, after `userList`).

- [ ] **Step 4: Create the page**

`page/welcome/style.ts`: copy `page/reset-password/style.ts` verbatim (same root/stack/content/form/lead/error classes) — the two screens must look identical.

`page/welcome/index.tsx`:

```tsx
import { useActionState, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { BrandLockup, Card, Page } from '~/component';
import { Button, TextInput } from '~/control';
import { extractAccessToken, setToken } from '~/lib/token';
import { path } from '~/router';

import { useStyle } from './style';

/**
 * Where a welcome email's link lands: a newly registered account chooses its
 * first password with the code it was sent. `POST /api/onboard` also confirms
 * the address and signs the user in — storing the returned token is enough for
 * `UnprotectedRoute` to send them on to the library, exactly as the login page
 * relies on.
 *
 * Both fields are prefilled from the link but editable: on an install with no
 * `publicUrl` the email carries only a code, and the user arrives here from the
 * login page's "Set up a new account" button.
 */
export const WelcomePage = () => {
  const styles = useStyle();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState<string>(searchParams.get('email') ?? '');
  const [code, setCode] = useState<string>(searchParams.get('code') ?? '');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Client-side only, and NOT a security boundary: the server enforces the
  // 8-character floor independently.
  const canSubmit =
    email !== '' && code !== '' && newPassword.length >= 8 && newPassword === confirmPassword;

  const [, submitAction, isPending] = useActionState(async () => {
    setError(null);
    if (!canSubmit) {
      setError(
        newPassword !== confirmPassword
          ? 'Those passwords do not match'
          : 'Fill in every field; the password must be at least 8 characters'
      );
      return null;
    }
    try {
      const response = await fetch('/api/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword }),
      });
      if (response.ok) {
        const accessToken = extractAccessToken(await response.json());
        if (accessToken) {
          setToken(accessToken);
        } else {
          setError('Unexpected response from server');
        }
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
      if (response.status === 404) {
        setError('Email is not configured on this server. Ask the administrator to set it up.');
        return null;
      }
      // Not forgot-password: that flow needs a verified address, which this
      // account does not have until onboarding succeeds.
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(
        `${body.error ?? 'That link is not valid or has expired.'} Ask your library admin to register you again.`
      );
    } catch {
      setError('Network error — please try again');
    }
    return null;
  }, null);

  return (
    <Page type="minimal">
      <div className={styles.root}>
        <BrandLockup />
        <div className={styles.stack}>
          <Card>
            <div className={styles.content}>
              <form className={styles.form} action={submitAction}>
                <TextInput
                  placeholder="Email address"
                  name="email"
                  autoCapitalize="none"
                  onChange={(value) => setEmail(value ?? '')}
                  value={email}
                />
                <TextInput
                  placeholder="Welcome code"
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
                  Set password
                </Button>
                {error === null ? null : <p className={styles.error}>{error}</p>}
              </form>
            </div>
          </Card>
          <Button type="default" onClick={() => void navigate(path.login())}>
            Back to sign in
          </Button>
        </div>
      </div>
    </Page>
  );
};
```

`page/index.ts`: `export { WelcomePage } from './welcome';` (alphabetical position).

`router/component.tsx`: import `WelcomePage`; add inside the `UnprotectedRoute` group, after the reset-password route:

```tsx
          <Route path={path.welcome()} element={<WelcomePage />} />
```

- [ ] **Step 5: Add the login-page button**

In `page/login/index.tsx`, replace the forgot-password block with:

```tsx
          {emailEnabled ? (
            <>
              <Button type="default" onClick={() => void navigate(path.forgotPassword())}>
                Forgot password?
              </Button>
              {/* An install without `publicUrl` sends a welcome code but no
                  link, so this is how a new user reaches the welcome page. */}
              <Button type="default" onClick={() => void navigate(path.welcome())}>
                Set up a new account
              </Button>
            </>
          ) : null}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/page/welcome src/page/login src/router`
Expected: PASS.

- [ ] **Step 7: Full verification**

Run (in `app/server`): `npm test` — Expected: PASS.
Run (in `app/client`): `npm test` — Expected: PASS.
Run (repo root): `npm run lint` — Expected: clean (includes `graphql:schema:check` and `codegen:check`).

- [ ] **Step 8: Commit**

```bash
git add app/client/src/router app/client/src/page/welcome app/client/src/page/index.ts app/client/src/page/login
git commit -m "feat(client): add the welcome page that completes onboarding"
```
