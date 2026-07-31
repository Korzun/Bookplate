import { buildSchema } from 'graphql';

import { printSchemaToString } from './print-schema';

describe('printSchemaToString', () => {
  it('sorts types and fields lexicographically so diffs stay stable', () => {
    const schema = buildSchema(`
      type Zebra { b: String, a: String }
      type Apple { d: String, c: String }
      type Query { zebra: Zebra, apple: Apple }
    `);

    const printed = printSchemaToString(schema);

    expect(printed.indexOf('type Apple')).toBeLessThan(printed.indexOf('type Zebra'));
    expect(printed.indexOf('a: String')).toBeLessThan(printed.indexOf('b: String'));
  });

  it('ends with exactly one trailing newline', () => {
    const schema = buildSchema('type Query { a: String }');

    const printed = printSchemaToString(schema);

    expect(printed.endsWith('\n')).toBe(true);
    expect(printed.endsWith('\n\n')).toBe(false);
  });
});
