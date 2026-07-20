import { entityReplacements, replaceEntities, replaceQuotes, simplifyContent } from './simplify';

vi.mock('../logger');

const FILE = 'test.xhtml';

describe('replaceEntities', () => {
  it('should replace &#8217; with right single quotation mark', () => {
    const input = 'It&#8217;s a test';
    const expected = 'It’s a test';
    expect(replaceEntities(FILE, input)).toBe(expected);
  });

  it('should replace &#8230; with ellipsis', () => {
    const input = 'Wait&#8230;there&#8217;s more';
    const expected = 'Wait…there’s more';
    expect(replaceEntities(FILE, input)).toBe(expected);
  });

  it('should replace &#8211; with en dash', () => {
    const input = 'Pages 10&#8211;20';
    const expected = 'Pages 10–20';
    expect(replaceEntities(FILE, input)).toBe(expected);
  });

  it('should replace &#8212; with em dash', () => {
    const input = 'The end&#8212;or is it?';
    const expected = 'The end—or is it?';
    expect(replaceEntities(FILE, input)).toBe(expected);
  });

  it('should replace multiple entities in the same string', () => {
    const input = 'It&#8217;s 10&#8211;20&#8230;maybe 30&#8212;40';
    const expected = 'It’s 10–20…maybe 30—40';
    expect(replaceEntities(FILE, input)).toBe(expected);
  });

  it('should handle strings with no entities', () => {
    const input = 'This is a normal string';
    expect(replaceEntities(FILE, input)).toBe(input);
  });

  it('should handle empty strings', () => {
    expect(replaceEntities(FILE, '')).toBe('');
  });

  it('should replace all occurrences of the same entity', () => {
    const input = '&#8217;&#8217;&#8217;';
    const expected = '’’’';
    expect(replaceEntities(FILE, input)).toBe(expected);
  });
});

describe('replaceQuotes', () => {
  it('should replace single <q> tag with double quotes', () => {
    const input = 'He said <q>Hello world</q>';
    const expected = 'He said “Hello world”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should replace <q> tag with a single attribute', () => {
    const input = 'He said <q class="test">Hello</q>';
    const expected = 'He said “Hello”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should replace <q> tag with multiple attributes', () => {
    const input = 'He said <q class="test" id="quote1">Hello</q>';
    const expected = 'He said “Hello”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should replace multiple non-nested <q> tags', () => {
    const input = 'First <q>one</q> and second <q>two</q>';
    const expected = 'First “one” and second “two”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should replace nested <q> tags with single quotes for inner', () => {
    const input = 'He said <q>outer <q>inner</q> text</q>';
    const expected = `He said “outer ‘inner’ text”`;
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle deeply nested <q> tags', () => {
    const input = '<q>level1 <q>level2 <q>level3</q> text2</q> text1</q>';
    const expected = `“level1 ‘level2 “level3” text2’ text1”`;
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags with newlines', () => {
    const input = '<q>line1\nline2</q>';
    const expected = '“line1\nline2”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle empty <q> tags', () => {
    const input = '<q></q>';
    const expected = '“”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags with only whitespace', () => {
    const input = '<q>   </q>';
    const expected = '“   ”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle case-insensitive <q> tags', () => {
    const input = '<Q>test</Q>';
    const expected = '“test”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags with mixed case', () => {
    const input = '<q>test</Q>';
    const expected = '“test”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should not modify content without <q> tags', () => {
    const input = 'Just regular text with no quotes';
    expect(replaceQuotes(FILE, input)).toBe(input);
  });

  it('should handle adjacent <q> tags', () => {
    const input = '<q>first</q><q>second</q>';
    const expected = '“first”“second”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags with special characters', () => {
    const input = '<q>&lt;script&gt;alert("xss")&lt;/script&gt;</q>';
    const expected = '“&lt;script&gt;alert("xss")&lt;/script&gt;”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags with quotes in content', () => {
    const input = '<q>He said "hello"</q>';
    const expected = '“He said "hello"”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle multiple levels of nesting', () => {
    const input = '<q>a <q>b <q>c</q> d</q> e</q>';
    const expected = `“a ‘b “c” d’ e”`;
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags at the start of content', () => {
    const input = '<q>start</q> end';
    const expected = '“start” end';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags at the end of content', () => {
    const input = 'start <q>end</q>';
    const expected = 'start “end”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle <q> tags spanning multiple lines', () => {
    const input = '<q>line1\nline2\nline3</q>';
    const expected = '“line1\nline2\nline3”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle empty string', () => {
    expect(replaceQuotes(FILE, '')).toBe('');
  });

  it('should handle content with only <q> tags', () => {
    const input = '<q>content</q>';
    const expected = '“content”';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });

  it('should handle unclosed <q> tags gracefully', () => {
    const input = '<q>unclosed';
    const expected = '“unclosed';
    expect(replaceQuotes(FILE, input)).toBe(expected);
  });
});

describe('entityReplacements', () => {
  it('exports the entity -> character replacement table', () => {
    expect(entityReplacements).toHaveLength(4);
    expect(entityReplacements.map((entity) => entity.replacement)).toEqual(['’', '…', '–', '—']);
  });
});

describe('simplifyContent', () => {
  it('replaces both entities and <q> tags', () => {
    const input = 'She said <q>it&#8217;s over&#8230;</q>';
    const expected = 'She said “it’s over…”';
    expect(simplifyContent(FILE, input)).toBe(expected);
  });
});
