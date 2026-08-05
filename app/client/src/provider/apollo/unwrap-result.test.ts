import { describe, expect, it } from 'vitest';

import { unwrapResult } from './unwrap-result';

describe('unwrapResult', () => {
  it('returns the payload when the result is the expected member', () => {
    const result = unwrapResult(
      { __typename: 'DeviceCreatePayload', device: { __typename: 'Device', id: 'd1' } },
      'DeviceCreatePayload'
    );

    expect(result).toEqual({
      status: 'ok',
      payload: { __typename: 'DeviceCreatePayload', device: { __typename: 'Device', id: 'd1' } },
    });
  });

  // A nullable mutation field resolves null when the entity does not exist.
  // That is NOT an error the server described — it is a distinct third case,
  // and a caller that collapses it into the error branch reports a fabricated
  // message the server never sent.
  it('reports a null result as missing, not as an error', () => {
    expect(unwrapResult(null, 'DeviceUpdatePayload')).toEqual({ status: 'missing' });
    expect(unwrapResult(undefined, 'DeviceUpdatePayload')).toEqual({ status: 'missing' });
  });

  it('surfaces a typed error member with the server message and its typename', () => {
    const result = unwrapResult(
      { __typename: 'DeviceSlugConflictError', message: 'Slug already in use', slug: 'kindle' },
      'DeviceCreatePayload'
    );

    expect(result).toEqual({
      status: 'error',
      message: 'Slug already in use',
      typename: 'DeviceSlugConflictError',
    });
  });

  // InvalidInputError carries per-field issues. The generic branch must not
  // drop them on the floor by reading only `message`.
  it('keeps a typed error distinguishable by typename so callers can branch', () => {
    const result = unwrapResult(
      { __typename: 'InvalidInputError', message: 'Invalid input', issues: [] },
      'UserRegisterPayload'
    );

    expect(result).toMatchObject({ status: 'error', typename: 'InvalidInputError' });
  });
});
