import { GraphQLError } from 'graphql';

import { rejectOversizeIdBatch, rejectOversizePage } from './pagination';

describe('rejectOversizePage', () => {
  it('allows a request exactly at maxSize', () => {
    expect(() => rejectOversizePage('Field', { first: 10 }, 10)).not.toThrow();
  });

  it('allows a request below maxSize', () => {
    expect(() => rejectOversizePage('Field', { first: 1 }, 10)).not.toThrow();
  });

  it('allows an omitted `first`', () => {
    expect(() => rejectOversizePage('Field', {}, 10)).not.toThrow();
    expect(() => rejectOversizePage('Field', { first: null }, 10)).not.toThrow();
  });

  it('rejects a request one over maxSize with PAGE_SIZE_EXCEEDED / 400', () => {
    expect(() => rejectOversizePage('Field', { first: 11 }, 10)).toThrowError(
      expect.objectContaining({
        message: 'Field allows at most 10 items per page (requested 11).',
        extensions: { code: 'PAGE_SIZE_EXCEEDED', http: { status: 400 } },
      })
    );
  });

  it('throws a GraphQLError instance, not a plain Error', () => {
    expect(() => rejectOversizePage('Field', { first: 999999999 }, 100)).toThrow(GraphQLError);
  });
});

describe('rejectOversizeIdBatch', () => {
  it('allows a batch exactly at maxSize', () => {
    expect(() => rejectOversizeIdBatch('Query.nodes', Array(10).fill('x'), 10)).not.toThrow();
  });

  it('allows an empty batch', () => {
    expect(() => rejectOversizeIdBatch('Query.nodes', [], 10)).not.toThrow();
  });

  it('rejects a batch one over maxSize with PAGE_SIZE_EXCEEDED / 400', () => {
    expect(() => rejectOversizeIdBatch('Query.nodes', Array(11).fill('x'), 10)).toThrowError(
      expect.objectContaining({
        message: 'Query.nodes accepts at most 10 ids per request (requested 11).',
        extensions: { code: 'PAGE_SIZE_EXCEEDED', http: { status: 400 } },
      })
    );
  });
});
