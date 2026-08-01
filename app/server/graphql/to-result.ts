import {
  BookAlreadyExistsError,
  BookHashCollisionError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  SelfLinkError,
} from '../services/book-store';
import { DeviceSlugConflictError } from '../services/device-store';
import { EpubValidationError } from '../services/epub-validator';

/**
 * The seven domain failures the stores raise deliberately, as opposed to the
 * database and filesystem failures they let escape. Every one of them has a
 * typed GraphQL counterpart under `schema/*-error/` that a client is expected
 * to render and act on.
 *
 * Listed as classes (not names) because membership is decided by `instanceof`:
 * an `Error` whose `name` merely reads "SelfLinkError" is not one, and must
 * not be presented to a client as a domain outcome.
 */
const KNOWN_STORE_ERROR_CLASSES = [
  BookHashCollisionError,
  BookAlreadyExistsError,
  SelfLinkError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  DeviceSlugConflictError,
  EpubValidationError,
] as const;

export type KnownStoreError =
  | BookHashCollisionError
  | BookAlreadyExistsError
  | SelfLinkError
  | DocumentAlreadyLinkedError
  | DocumentIsBookError
  | DeviceSlugConflictError
  | EpubValidationError;

export type MutationResult<T> = { ok: T } | { err: KnownStoreError };

export const isKnownStoreError = (value: unknown): value is KnownStoreError =>
  KNOWN_STORE_ERROR_CLASSES.some((errorClass) => value instanceof errorClass);

/**
 * The single `try`/`catch` the spec allows a mutation, factored out of every
 * resolver: it turns the known store failures into values and lets everything
 * else keep travelling as an exception, so genuinely unexpected failures still
 * reach yoga's masking and the error log as today's 500s do.
 *
 * Resolver bodies therefore contain no `try`, no `catch` and no `throw` — the
 * boundary is here, in one place, rather than repeated (and eventually
 * mis-repeated) twenty-three times.
 *
 * NOT to be wrapped around a store call that raises none of the seven: the
 * `err` branch would then be unreachable, and the only ways to discharge it in
 * a resolver are to throw (forbidden) or to mislabel it as some error the
 * mutation's result union does happen to contain (worse). `progress/mutation/
 * delete.ts` is the current example and says so at its call site.
 */
export const toResult = async <T>(run: () => Promise<T>): Promise<MutationResult<T>> => {
  try {
    return { ok: await run() };
  } catch (error) {
    if (isKnownStoreError(error)) return { err: error };
    throw error;
  }
};
