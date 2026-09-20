# Email address ownership: releasing a claim, and letting the admin see one

Date: 2026-09-20
Status: approved design, not yet planned

## Context

The email-identity work (`2026-09-19-email-identity-design.md`) made `User.emailKey`
a plain `@unique`, so one address belongs to at most one account. A late review of
that branch found the consequence it had not considered: **a claim is permanent and
invisible.**

- A user can set an address they do not own. Verification gates outbound mail and
  password reset, so they gain nothing by it — but the unique constraint now blocks
  the real owner from ever setting that address.
- There is **no way to release the claim.** `viewerSetEmail` writes only the caller's
  own row, no mutation writes another user's address, and `User` exposes no email
  field at all — so the operator cannot clear it, and cannot even see who holds it.
  Today the only remedy is deleting the account.

Three facts bound the severity, and shape the fix:

- **There is no self-registration.** `userRegister` is admin-only, so every account
  exists because the household operator created it. The realistic failure is a typo
  or a stale claim, not an attack.
- **Verification is the real gate.** An unverified claim confers nothing: no mail is
  sent to it, and `/api/password/forgot` refuses it. Claiming an address you do not
  control cannot escalate to anything.
- **The undiagnosability is the sharper problem.** When a user reports "it says my
  address is already in use", the operator currently has no way to find out who holds
  it, or whether anyone does.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| May two accounts share an address? | **No — uniqueness stays** | Keeps login-by-email and password reset resolving to exactly one account. Dropping it would make both ambiguous. |
| How is a claim released? | **An admin action, and only that** | See "Rejected" below — an automatic takeover is symmetric and silently destroys a pending address. |
| Does the operator get visibility? | **Yes — address and confirmed state on `User`** | Answers "who holds this?", which nothing can answer today. |
| Does the operator get a lever? | **Yes — `userClearEmail`** | Without it, visibility tells the operator what is wrong and leaves them unable to fix it. |

### Rejected: letting a blocked user take over an unverified claim

Tempting, because it self-corrects with no operator involvement. Rejected for two
reasons:

1. **It is symmetric, so it can ping-pong.** If A holds `a@example.com` unverified and
   B claims it, A can reclaim, and so on. It converges only when whoever genuinely
   controls the inbox verifies — but the intermediate states are churn, and the
   constraint is supposed to make ownership stable.
2. **It silently destroys a pending address**, and the one address you cannot notify
   the loser at is the one they just lost. A user who set a correct address and had not
   yet confirmed it would find themselves re-gated with no explanation.

With an operator who can see and clear, the explicit path is better, and one mechanism
beats two overlapping ones.

## Design

### `User.email` and `User.emailVerifiedAt`

Both exposed on the `User` node, each carrying
`authScopes: (parent) => ({ ownerOf: parent.id })` — the field-level pattern
`User.library` already uses, which resolves through `isOwnerOrAdmin` to
"this user, or an admin".

Declaring the scope at the field rather than relying on the node being unreachable is
deliberate: it states the intended boundary where a reader will look for it, and does
not silently widen if node reachability ever changes.

`emailVerifiedAt` is a `DateTime`, matching `Viewer.emailVerifiedAt`.

### `userClearEmail(input: { userId })` — admin only

Clears `email`, `emailKey` and `emailVerifiedAt` on the target row, and
**invalidates that user's outstanding email tokens** (`invalidateEmailTokens(prisma,
userId)`, both purposes): a verify or reset code is bound to an address the account no
longer holds, and must not stay spendable.

**Return shape:** a nullable payload exposing the cleared `user`, resolved by a fresh
`t.prismaField` lookup, inside a `<Name>Result` union per this schema's binding rule —
matching `userDelete`, which returns `null` both for a row that does not exist and for
the admin refusal below, so the two are indistinguishable.

It does **not** revoke refresh tokens. Losing an address does not compromise a
password, and signing someone out for an operator's bookkeeping action would be
gratuitous.

**It must refuse the config admin row**, returning the file's ordinary "no such user"
result — the same shape and the same `isConfigAdminRow` guard `userDelete` and
`userResetPassword` use, so the row stays *unaddressable* rather than merely protected.
This mutation is exactly the cross-account-write shape those guards exist for: it is
the first mutation in this codebase that writes another user's address.

### Consequence: clearing re-gates the target

`mustSetEmail` is derived (`email == null && mailConfigured`), so on the target's next
token refresh — at most `ACCESS_TOKEN_TTL_SECONDS` later — they land on the set-email
screen. That is correct and automatic, and it means clearing an address interrupts
whoever holds it. The admin-facing confirmation copy says so.

### `EmailInUseError`

Reworded to point at the remedy ("ask your administrator") rather than stating only
that the address is taken.

The message stays **uniform**: it must not reveal who holds the address, nor whether
they have confirmed it. That is operator-only information, and the error is returned to
whoever tried to claim the address.

### Client

`page/user-list` (and its row component) shows each user's address and confirmed
state, with a clear action. The confirmation names the consequence above — that the user will be asked to
set an address again.

## Testing

- `User.email`/`emailVerifiedAt` are readable by an admin for any user, and by a user
  for their own row; a non-admin cannot read another user's.
- `userClearEmail` clears all three columns and invalidates both token purposes.
- **It refuses the config admin row, and that row's address is still present
  afterwards** — the second assertion is load-bearing, exactly as it is in
  `userResetPassword`'s guard test: a mutation that returns the right result while
  still writing would pass a refusal-only test.
- After a clear, the previously-blocked user can set that address.
- With mail configured, the cleared user's next token carries `mustSetEmail: true`.
- `EmailInUseError`'s message is identical whether the holder is confirmed or not.

## Out of scope

Letting two accounts share an address; automatic or time-based release of claims;
any change to what verification gates; any change to login-by-email.

**A claim squatted by the config-admin row.** The config admin now has a `User` row
(`services/admin-account.ts`) that can hold an address like any other, but `Viewer.users`
filters it out (`NOT_CONFIG_ADMIN`) and `userClearEmail` refuses it, same as `userDelete`
and `userResetPassword`. So if the operator's own address is what a claimant collides
with, the admin list shows no holder for it — the one case where this spec's "who holds
this?" promise does not hold. Both decisions stay as they are: config-admin
unaddressability is consistent with the other admin-only mutations, and surfacing that
row in the admin list would be a product decision, not a defect fix. The recovery path
still exists and is not automatic: the operator sees their own address on
`component/email-setting` and can replace it there, which frees the old key — they
cannot null it, only replace it, same as any other viewer.

## Known traps

1. `userClearEmail` writes another user's row — the first mutation to do so. It needs
   the `isConfigAdminRow` guard, and its test needs the "no write happened" assertion,
   not just the refusal.
2. Exposing an address on `User` widens what an admin can see. The field scope must be
   `ownerOf`, not absent — absent would rely on node reachability, which is a weaker
   and less obvious guarantee.
3. The `EmailInUseError` message must not become conditional on the holder's verified
   state; that would leak a fact about another account to whoever probed the address.
