/**
 * Every mutation in this schema returns a `<Name>Result` UNION — even
 * single-member ones — and most result fields are nullable ("Resolves to null
 * when the … does not exist"). So a call site has three outcomes, not two:
 *
 *   missing  the field resolved null: the entity is gone. NOT an error the
 *            server described, and reporting it as one invents a message.
 *   error    a typed `UserError` member: the server's own message, and a
 *            `typename` so a caller can branch (e.g. InvalidInputError's
 *            per-field issues vs a flat conflict).
 *   ok       the expected payload member.
 *
 * Transport failures never reach here — those are thrown by Apollo and handled
 * by the link chain. Typed errors arrive in `data` and are ordinary values.
 */
export type UnwrappedResult<TPayload> =
  | { status: 'ok'; payload: TPayload }
  | { status: 'error'; message: string; typename: string }
  | { status: 'missing' };

type MaybeMember = { __typename?: string; message?: string } | null | undefined;

export const unwrapResult = <TPayload extends { __typename?: string }>(
  result: MaybeMember,
  payloadTypename: TPayload extends { __typename?: infer N } ? N : never
): UnwrappedResult<TPayload> => {
  if (result === null || result === undefined) return { status: 'missing' };

  if (result.__typename === payloadTypename) {
    return { status: 'ok', payload: result as TPayload };
  }

  return {
    status: 'error',
    message: result.message ?? 'Something went wrong',
    typename: result.__typename ?? 'UnknownError',
  };
};
