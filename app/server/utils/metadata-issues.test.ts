import { detectMetadataIssues, MetadataIssue } from './metadata-issues';

const base = {
  title: 'Blindsight',
  titleSort: '',
  author: 'Peter Watts',
  authorSort: 'Watts, Peter',
  subjects: [] as string[],
};

const find = (issues: MetadataIssue[], kind: string) => issues.find((i) => i.kind === kind);

describe('detectMetadataIssues', () => {
  it('returns no issues for already-clean metadata', () => {
    expect(detectMetadataIssues(base)).toEqual([]);
  });

  it('de-inverts "Last, First" author and sets author sort (auto)', () => {
    const issues = detectMetadataIssues({ ...base, author: 'Watts, Peter', authorSort: '' });
    const inv = find(issues, 'author-inverted')!;
    expect(inv.to).toBe('Peter Watts');
    expect(inv.autoEligible).toBe(true);
    expect(inv.changes).toEqual({ author: 'Peter Watts', authorSort: 'Watts, Peter' });
    // must NOT also emit author-sort-missing for the same author
    expect(find(issues, 'author-sort-missing')).toBeUndefined();
  });

  it('fills missing author sort for a 2-token name (auto)', () => {
    const issues = detectMetadataIssues({ ...base, authorSort: '' });
    const s = find(issues, 'author-sort-missing')!;
    expect(s.to).toBe('Watts, Peter');
    expect(s.autoEligible).toBe(true);
    expect(s.changes).toEqual({ authorSort: 'Watts, Peter' });
  });

  it('fills missing author sort for a mononym (auto)', () => {
    const issues = detectMetadataIssues({ ...base, author: 'Homer', authorSort: '' });
    const s = find(issues, 'author-sort-missing')!;
    expect(s.to).toBe('Homer');
    expect(s.autoEligible).toBe(true);
    expect(s.changes).toEqual({ authorSort: 'Homer' });
  });

  it('fills missing author sort for a reliable 3-token / initials name (auto)', () => {
    const issues = detectMetadataIssues({ ...base, author: 'N. K. Jemisin', authorSort: '' });
    const s = find(issues, 'author-sort-missing')!;
    expect(s.to).toBe('Jemisin, N. K.');
    expect(s.autoEligible).toBe(true);
    expect(s.changes).toEqual({ authorSort: 'Jemisin, N. K.' });
  });

  it('proposes (not auto) author sort for particle names (unreliable derivation)', () => {
    const issues = detectMetadataIssues({ ...base, author: 'Ursula K. Le Guin', authorSort: '' });
    const s = find(issues, 'author-sort-missing')!;
    // The naive split would produce the wrong "Guin, Ursula K. Le", so it must
    // stay a proposal for the user to confirm.
    expect(s.autoEligible).toBe(false);
    expect(s.to).toBe('Guin, Ursula K. Le');
    expect(s.changes).toEqual({ authorSort: 'Guin, Ursula K. Le' });
  });

  it('gates a glued multi-author string to a proposal (never auto)', () => {
    const issues = detectMetadataIssues({ ...base, author: 'Bob&Sue Smith', authorSort: '' });
    const s = find(issues, 'author-sort-missing')!;
    expect(s.autoEligible).toBe(false);
  });

  it('strips a trailing suffix so it is not mistaken for the surname', () => {
    const issues = detectMetadataIssues({ ...base, author: 'John Smith Jr', authorSort: '' });
    const s = find(issues, 'author-sort-missing')!;
    expect(s.to).toBe('Smith, John Jr');
    expect(s.autoEligible).toBe(false);
  });

  it('flags a present-but-wrong author sort (equals display author)', () => {
    const issues = detectMetadataIssues({ ...base, authorSort: 'Peter Watts' });
    const s = find(issues, 'author-sort-wrong')!;
    expect(s.from).toBe('Peter Watts');
    expect(s.to).toBe('Watts, Peter');
    expect(s.autoEligible).toBe(true);
  });

  it('does NOT de-invert a stray-comma-among-initials name; proposes a comma fix', () => {
    const issues = detectMetadataIssues({
      ...base,
      author: 'James S. A, Corey',
      authorSort: 'Corey, James S. A.',
    });
    expect(find(issues, 'author-inverted')).toBeUndefined();
    const c = find(issues, 'author-initials-comma')!;
    expect(c.to).toBe('James S. A. Corey');
    expect(c.autoEligible).toBe(false);
    expect(c.changes).toEqual({ author: 'James S. A. Corey' });
  });

  it('fixes missing spaces between initials (auto)', () => {
    const issues = detectMetadataIssues({
      ...base,
      author: 'James S.A. Corey',
      authorSort: 'Corey, James S. A.',
    });
    const sp = find(issues, 'author-initials-spacing')!;
    expect(sp.to).toBe('James S. A. Corey');
    expect(sp.autoEligible).toBe(true);
  });

  it('derives title sort by stripping a leading article (auto)', () => {
    const issues = detectMetadataIssues({ ...base, title: 'The Left Hand of Darkness' });
    const t = find(issues, 'title-sort-missing')!;
    expect(t.to).toBe('Left Hand of Darkness, The');
    expect(t.autoEligible).toBe(true);
    expect(t.changes).toEqual({ titleSort: 'Left Hand of Darkness, The' });
  });

  it('fixes a title sort that itself starts with an article', () => {
    const issues = detectMetadataIssues({
      ...base,
      title: 'The Left Hand of Darkness',
      titleSort: 'The Left Hand of Darkness',
    });
    expect(find(issues, 'title-sort-missing')!.to).toBe('Left Hand of Darkness, The');
  });

  it('does not raise a title-sort issue when the title has no leading article', () => {
    expect(find(detectMetadataIssues(base), 'title-sort-missing')).toBeUndefined();
  });

  it('collapses internal whitespace (auto)', () => {
    const issues = detectMetadataIssues({ ...base, title: 'Blind  sight' });
    const w = find(issues, 'whitespace')!;
    expect(w.to).toBe('Blind sight');
    expect(w.autoEligible).toBe(true);
    expect(w.changes).toEqual({ title: 'Blind sight' });
  });

  it('decodes HTML entities in title/author (auto)', () => {
    const issues = detectMetadataIssues({ ...base, title: 'Cats &amp; Dogs' });
    const e = find(issues, 'html-entity')!;
    expect(e.to).toBe('Cats & Dogs');
    expect(e.autoEligible).toBe(true);
    expect(e.changes).toEqual({ title: 'Cats & Dogs' });
  });

  it('flags a mojibake replacement char without proposing a fix', () => {
    const issues = detectMetadataIssues({ ...base, title: 'Caf�' });
    const e = find(issues, 'html-entity')!;
    expect(e.to).toBeNull();
    expect(e.autoEligible).toBe(false);
    expect(e.changes).toEqual({});
  });

  it('proposes title-case for an ALL CAPS title (not auto)', () => {
    const issues = detectMetadataIssues({ ...base, title: 'BLINDSIGHT NOVEL' });
    const a = find(issues, 'title-allcaps')!;
    expect(a.to).toBe('Blindsight Novel');
    expect(a.autoEligible).toBe(false);
    expect(a.changes).toEqual({ title: 'Blindsight Novel' });
  });

  it('flags a title that equals the filename stem (flag only)', () => {
    const issues = detectMetadataIssues({
      ...base,
      title: 'book_final_v2',
      filenameStem: 'book_final_v2',
    });
    const f = find(issues, 'title-is-filename')!;
    expect(f.to).toBeNull();
    expect(f.autoEligible).toBe(false);
    expect(f.changes).toEqual({});
  });

  it('proposes splitting a compound subject as one fix, flagging library matches', () => {
    const issues = detectMetadataIssues({
      ...base,
      subjects: ['Sci-Fi & Fantasy'],
      librarySubjects: ['Sci-Fi', 'Fantasy'],
    });
    const s = find(issues, 'subjects-split')!;
    expect(s.from).toBe('Sci-Fi & Fantasy');
    expect(s.to).toBe('Sci-Fi, Fantasy');
    expect(s.autoEligible).toBe(false);
    expect(s.reason).toBe('Both already exist in your library');
    // The split operation is carried by the chips; the patch is computed at apply time.
    expect(s.changes).toEqual({});
    expect(s.fromChips).toEqual(['Sci-Fi & Fantasy']);
    expect(s.toChips).toEqual(['Sci-Fi', 'Fantasy']);
  });

  it('emits one subjects-split fix per compound subject', () => {
    const issues = detectMetadataIssues({
      ...base,
      subjects: ['Sci-Fi & Fantasy', 'Arts & Crafts'],
    });
    const splitIssues = issues.filter((i) => i.kind === 'subjects-split');
    expect(splitIssues).toHaveLength(2);
    expect(splitIssues.map((s) => s.from)).toEqual(['Sci-Fi & Fantasy', 'Arts & Crafts']);
    expect(splitIssues[0].toChips).toEqual(['Sci-Fi', 'Fantasy']);
    expect(splitIssues[0].fromChips).toEqual(['Sci-Fi & Fantasy']);
    expect(splitIssues[0].changes).toEqual({});
    expect(splitIssues[1].toChips).toEqual(['Arts', 'Crafts']);
    expect(splitIssues[1].fromChips).toEqual(['Arts & Crafts']);
  });

  it('dedupes an exact-duplicate compound subject to a single fix', () => {
    const issues = detectMetadataIssues({
      ...base,
      subjects: ['Sci-Fi & Fantasy', 'Sci-Fi & Fantasy'],
    });
    const splitIssues = issues.filter((i) => i.kind === 'subjects-split');
    expect(splitIssues).toHaveLength(1);
    expect(splitIssues[0].from).toBe('Sci-Fi & Fantasy');
    expect(splitIssues[0].toChips).toEqual(['Sci-Fi', 'Fantasy']);
  });

  it('splits comma-separated compounds into separate per-compound fixes', () => {
    const issues = detectMetadataIssues({
      ...base,
      subjects: ['Sci-Fi, Fantasy', 'Fantasy & Horror'],
    });
    const splitIssues = issues.filter((i) => i.kind === 'subjects-split');
    expect(splitIssues).toHaveLength(2);
    // Each fix carries its own parts; cross-compound dedupe now happens at apply time.
    expect(splitIssues[0].from).toBe('Sci-Fi, Fantasy');
    expect(splitIssues[0].toChips).toEqual(['Sci-Fi', 'Fantasy']);
    expect(splitIssues[1].from).toBe('Fantasy & Horror');
    expect(splitIssues[1].toChips).toEqual(['Fantasy', 'Horror']);
  });

  it('never throws on empty input', () => {
    expect(
      detectMetadataIssues({ title: '', titleSort: '', author: '', authorSort: '', subjects: [] })
    ).toEqual([]);
  });

  it('is total: a malformed (undefined) subjects array yields no issues instead of throwing', () => {
    expect(
      detectMetadataIssues({
        title: 'x',
        titleSort: '',
        author: '',
        authorSort: '',
        subjects: undefined as never,
      })
    ).toEqual([]);
  });

  it('is total: an out-of-range numeric entity never throws and yields an array', () => {
    let issues: MetadataIssue[] = [];
    expect(() => {
      issues = detectMetadataIssues({
        title: 'A &#x110000; B',
        titleSort: '',
        author: 'Peter Watts',
        authorSort: 'Watts, Peter',
        subjects: [],
      });
    }).not.toThrow();
    expect(Array.isArray(issues)).toBe(true);
    // The out-of-range entity is left unchanged (not decoded), so it should
    // not produce a decode proposal with a non-null `to`.
    const entityIssue = find(issues, 'html-entity');
    if (entityIssue) expect(entityIssue.to).toBeNull();
  });
});
