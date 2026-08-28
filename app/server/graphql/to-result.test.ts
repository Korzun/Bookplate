import {
  BookAlreadyExistsError,
  BookHashCollisionError,
  DocumentAlreadyLinkedError,
  DocumentIsBookError,
  SelfLinkError,
} from '../services/book-store';
import { DeviceSlugConflictError } from '../services/device';
import { EpubValidationError } from '../services/epub-validator';
import {
  assertUnreachableStoreError,
  isKnownStoreError,
  toResult,
  type KnownStoreError,
} from './to-result';

/**
 * The seven store error classes the spec names as "known", each constructed
 * exactly as its throwing call site constructs it. Table-driven on purpose:
 * an eighth class added to `to-result.ts` without a row here is a class no
 * test proves is caught, and a row here for a class `to-result.ts` forgot is
 * an immediate failure rather than a silent 500 in production.
 */
const knownErrors: [name: string, error: KnownStoreError][] = [
  ['BookHashCollisionError', new BookHashCollisionError('c'.repeat(32))],
  ['BookAlreadyExistsError', new BookAlreadyExistsError('e'.repeat(32))],
  ['SelfLinkError', new SelfLinkError()],
  ['DocumentAlreadyLinkedError', new DocumentAlreadyLinkedError('doc.epub')],
  ['DocumentIsBookError', new DocumentIsBookError('d'.repeat(32))],
  ['DeviceSlugConflictError', new DeviceSlugConflictError()],
  [
    'EpubValidationError',
    new EpubValidationError(
      [{ id: 'RSC-005', severity: 'ERROR', message: 'broken' }],
      { FATAL: 0, ERROR: 1, WARNING: 0, INFO: 0, USAGE: 0 },
      'ERROR'
    ),
  ],
];

describe('toResult', () => {
  it('returns ok for a resolved value', async () => {
    expect(await toResult(async () => 42)).toEqual({ ok: 42 });
  });

  it('returns ok for a falsy resolved value rather than treating it as failure', async () => {
    expect(await toResult(async () => false)).toEqual({ ok: false });
    expect(await toResult(async () => undefined)).toEqual({ ok: undefined });
  });

  it.each(knownErrors)('converts a thrown %s into an err value', async (_name, error) => {
    const result = await toResult(async () => {
      throw error;
    });

    expect(result).toEqual({ err: error });
    // Identity, not just deep equality: the caller reads properties such as
    // `collidingId` off the original instance to build its typed GraphQL error.
    expect('err' in result && result.err).toBe(error);
  });

  it('re-throws an unknown Error so it still reaches yoga masking', async () => {
    const boom = new Error('database is on fire');

    await expect(
      toResult(async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
  });

  it('re-throws a non-Error throwable', async () => {
    await expect(
      toResult(async () => {
        throw 'a string';
      })
    ).rejects.toBe('a string');
  });

  it('re-throws an Error whose name merely matches a known class', async () => {
    // Name-matching instead of `instanceof` would let any error impersonate a
    // domain error and be rendered to the client as one.
    const impostor = new Error('nope');
    impostor.name = 'BookHashCollisionError';

    await expect(
      toResult(async () => {
        throw impostor;
      })
    ).rejects.toBe(impostor);
  });

  describe('expected (task-2 review, Important-3)', () => {
    it('converts a thrown error into an err value when it is in the expected list', async () => {
      const error = new BookHashCollisionError('c'.repeat(32));

      const result = await toResult(async () => {
        throw error;
      }, [BookHashCollisionError, EpubValidationError]);

      expect(result).toEqual({ err: error });
    });

    it('re-throws a genuinely known store error that is NOT in the caller-declared expected list, instead of silently mislabelling it', async () => {
      // This is the exact failure mode Important-3 flags: a mis-traced call
      // site declares a narrower `expected` than what its wrapped call can
      // really throw. `BookAlreadyExistsError` is a real, `isKnownStoreError`-
      // recognised class — but it is not in this call's declared subset, so it
      // must rethrow (reaching yoga's masking, same as a REST 500 fallback)
      // rather than being coerced into `{ err: ... }` and rendered as
      // whichever of the two declared types a discharge's last branch
      // happens to return.
      const error = new BookAlreadyExistsError('e'.repeat(32));
      expect(isKnownStoreError(error)).toBe(true); // sanity: it IS a known class

      await expect(
        toResult(async () => {
          throw error;
        }, [BookHashCollisionError, EpubValidationError])
      ).rejects.toBe(error);
    });

    it('defaults to all seven known classes when expected is omitted (unchanged behaviour)', async () => {
      const error = new DeviceSlugConflictError();

      const result = await toResult(async () => {
        throw error;
      });

      expect(result).toEqual({ err: error });
    });
  });
});

describe('assertUnreachableStoreError', () => {
  it('throws — it exists to fail loudly, never to be reached by a live resolver path', () => {
    expect(() => assertUnreachableStoreError(undefined as never)).toThrow(
      'Unreachable store error'
    );
  });
});

describe('isKnownStoreError', () => {
  it.each(knownErrors)('recognises %s', (_name, error) => {
    expect(isKnownStoreError(error)).toBe(true);
  });

  it.each([
    ['a plain Error', new Error('x')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'BookHashCollisionError'],
    ['a lookalike object', { name: 'SelfLinkError', message: 'x' }],
  ])('rejects %s', (_name, value) => {
    expect(isKnownStoreError(value)).toBe(false);
  });
});
