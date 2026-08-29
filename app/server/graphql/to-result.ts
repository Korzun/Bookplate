import {
  BookAlreadyExistsError,
  BookHashCollisionError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  SelfLinkError,
} from '../services/book-errors';
import { DeviceSlugConflictError } from '../services/device';
import { EpubValidationError } from '../services/epub-validator';

/**
 * The seven domain failures raised deliberately by domain functions, as
 * opposed to the database and filesystem failures they let escape. Every one
 * of them has a typed GraphQL counterpart under `schema/*-error/` that a
 * client is expected to render and act on.
 *
 * Listed as classes (not names) because membership is decided by `instanceof`:
 * an `Error` whose `name` merely reads "SelfLinkError" is not one, and must
 * not be presented to a client as a domain outcome.
 */
const KNOWN_DOMAIN_ERROR_CLASSES = [
  BookHashCollisionError,
  BookAlreadyExistsError,
  SelfLinkError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  DeviceSlugConflictError,
  EpubValidationError,
] as const;

export type KnownDomainError =
  | BookHashCollisionError
  | BookAlreadyExistsError
  | SelfLinkError
  | DocumentAlreadyLinkedError
  | DocumentIsBookError
  | DeviceSlugConflictError
  | EpubValidationError;

export type MutationResult<T, E extends KnownDomainError = KnownDomainError> =
  | { ok: T }
  | { err: E };

export const isKnownDomainError = (value: unknown): value is KnownDomainError =>
  KNOWN_DOMAIN_ERROR_CLASSES.some((errorClass) => value instanceof errorClass);

/**
 * The single `try`/`catch` the spec allows a mutation, factored out of every
 * resolver: it turns the known domain failures into values and lets everything
 * else keep travelling as an exception, so genuinely unexpected failures still
 * reach yoga's masking and the error log as today's 500s do.
 *
 * Resolver bodies therefore contain no `try`, no `catch` and no `throw` — the
 * boundary is here, in one place, rather than repeated (and eventually
 * mis-repeated) twenty-three times.
 *
 * NOT to be wrapped around a call that raises none of the seven: the
 * `err` branch would then be unreachable, and the only ways to discharge it in
 * a resolver are to throw (forbidden) or to mislabel it as some error the
 * mutation's result union does happen to contain (worse). `progress/mutation/
 * delete.ts` is the current example and says so at its call site.
 *
 * `E` and `expected` let a call site narrow to exactly the subset a particular
 * call path can actually throw, e.g. `toResult(fn, [BookHashCollisionError,
 * EpubValidationError])`. Two things make this trustworthy rather than merely
 * asserted:
 *
 *  1. `expected` is checked at RUNTIME (`expected.some((c) => error instanceof
 *     c)`), not just typed — a call site that mis-traces its subset (declares
 *     fewer classes than the wrapped call can really throw) makes the
 *     untraced error rethrow, landing in yoga's masking exactly like an
 *     unexpected failure, instead of being silently cast to `E` and rendered
 *     as whichever declared error the discharge's last branch happens to
 *     return. Task 2's review (Important-3) is why this replaced the earlier
 *     `error as E` unchecked cast.
 *  2. `E` being a closed union (once `expected`'s element type is inferred
 *     from an array literal) lets TypeScript narrow `outcome.err` all the way
 *     to `never` after one `instanceof` check per member — which is what
 *     makes `assertUnreachableDomainError` below compile only when the
 *     discharge is genuinely exhaustive over `E`.
 *
 * Omitting `expected` defaults to all seven (`KNOWN_DOMAIN_ERROR_CLASSES`),
 * `E` defaults to the full `KnownDomainError` union, and every existing call
 * (there were none before task 2) keeps compiling and behaving identically —
 * this is additive.
 */
export const toResult = async <T, E extends KnownDomainError = KnownDomainError>(
  run: () => Promise<T>,
  expected: readonly (abstract new (...args: never[]) => E)[] = KNOWN_DOMAIN_ERROR_CLASSES as never
): Promise<MutationResult<T, E>> => {
  try {
    return { ok: await run() };
  } catch (error) {
    if (expected.some((errorClass) => error instanceof errorClass)) return { err: error as E };
    throw error;
  }
};

/**
 * The final statement of an exhaustive `err` discharge — one `instanceof`
 * branch per member of `E`, each returning, then this. Only compiles when
 * TypeScript has narrowed `outcome.err` to `never` at the call site, i.e. when
 * every member of the `expected` list passed to `toResult` was actually
 * checked. Add a member to a call site's `expected` list without adding its
 * `instanceof` branch to the discharge, and this line stops compiling —
 * a forgotten branch is a build failure, not a mislabelled runtime value.
 *
 * The `throw` here is deliberately not inside a resolver's `resolve` body
 * (satisfying "resolver bodies: zero try/catch/throw" literally, not just
 * behaviourally): this function is reachable only if `toResult`'s own runtime
 * `expected` check above already failed to prevent it, i.e. only as a defense
 * against a bug in `to-result.ts` or a call site passing an `expected` list
 * that doesn't match its own discharge — never as a live resolver path.
 */
export function assertUnreachableDomainError(error: never): never {
  throw new Error(`Unreachable domain error: ${String(error)}`);
}
