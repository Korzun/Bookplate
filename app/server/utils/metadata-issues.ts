export type MetadataField = 'title' | 'titleSort' | 'author' | 'authorSort' | 'subjects';

export type MetadataIssueKind =
  | 'whitespace'
  | 'html-entity'
  | 'author-initials-spacing'
  | 'author-initials-comma'
  | 'author-inverted'
  | 'author-sort-missing'
  | 'author-sort-wrong'
  | 'title-sort-missing'
  | 'title-allcaps'
  | 'title-is-filename'
  | 'subjects-split';

export interface MetadataIssue {
  field: MetadataField;
  kind: MetadataIssueKind;
  from: string;
  to: string | null;
  autoEligible: boolean;
  reason?: string;
  changes: Partial<Record<MetadataField, string | string[]>>;
  // For list-valued fixes (subjects-split), the before/after values as discrete
  // items so the UI can render them as chips instead of a joined string.
  fromChips?: string[];
  toChips?: string[];
}

export interface DetectInput {
  title: string;
  titleSort: string;
  author: string;
  authorSort: string;
  subjects: string[];
  filenameStem?: string;
  librarySubjects?: string[];
}

const LEADING_ARTICLE = /^(the|a|an)\s+(\S.*)$/i;
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const PARTICLES = new Set(['van', 'von', 'de', 'del', 'di', 'du', 'la', 'le', 'den', 'der', 'ter']);
const MULTI_AUTHOR = /(&|;|\sand\s|\swith\s)/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  szlig: 'ß',
};

const ENTITY_RE = /&(#\d+|#x[0-9a-f]+|[a-z]+);/gi;

// Matching control characters is intentional here (stripping them from metadata
// so they collapse to a single space); the no-control-regex rule is a false positive.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F]+/g;

function collapseWhitespace(s: string): string {
  return s.replace(CONTROL_CHARS, ' ').replace(/ {2,}/g, ' ').trim();
}

function hasEntity(s: string): boolean {
  return /&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s);
}

function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function fixInitialSpacing(name: string): string {
  // Insert a space between adjacent initials: "S.A." -> "S. A.", "S.A.B." -> "S. A. B."
  return name.replace(/([A-Za-z]\.)(?=[A-Za-z]\.)/g, '$1 ');
}

// A stray comma whose preceding token is a lone initial ("James S. A, Corey").
function fixStrayInitialComma(author: string): string | null {
  const fixed = author.replace(/(?<=(?:^|\s)[A-Za-z]),\s*/, '. ');
  return fixed !== author ? fixed : null;
}

function deriveAuthorSort(author: string): { value: string; auto: boolean } | null {
  const tokens = author.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { value: tokens[0], auto: true };
  const flagged = tokens.some(
    (t) => PARTICLES.has(t.toLowerCase()) || SUFFIXES.has(t.replace(/\.$/, '').toLowerCase())
  );
  if (tokens.length === 2 && !flagged) {
    return { value: `${tokens[1]}, ${tokens[0]}`, auto: true };
  }
  // Proposal branch: strip trailing suffix tokens (Jr, Sr, III, ...) so they don't
  // get mistaken for the surname, then append them after the given names.
  let end = tokens.length;
  const suffixTokens: string[] = [];
  while (end > 1 && SUFFIXES.has(tokens[end - 1].replace(/\.$/, '').toLowerCase())) {
    suffixTokens.unshift(tokens[end - 1]);
    end -= 1;
  }
  const coreTokens = tokens.slice(0, end);
  const surname = coreTokens[coreTokens.length - 1];
  const rest = coreTokens.slice(0, -1).join(' ');
  const suffixPart = suffixTokens.length ? ` ${suffixTokens.join(' ')}` : '';
  return { value: `${surname}, ${rest}${suffixPart}`, auto: false };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function isAllCaps(title: string): boolean {
  const letters = title.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && title === title.toUpperCase() && title !== title.toLowerCase();
}

// Compound-subject separators. Comma is included because publishers/Calibre
// often join tags with commas (e.g. "Sci-Fi, Fantasy"); "Last, First" person
// forms are an author-field concern and do not occur in subjects. Splitting is
// proposal-only, so any unwanted split can be dismissed.
function splitSubject(subject: string): string[] {
  return subject
    .split(/\s*(?:&|\/|;|,)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function detectMetadataIssues(input: DetectInput): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  const scalar: Record<'title' | 'titleSort' | 'author' | 'authorSort', string> = {
    title: input.title ?? '',
    titleSort: input.titleSort ?? '',
    author: input.author ?? '',
    authorSort: input.authorSort ?? '',
  };

  // 1. Whitespace hygiene on every scalar field.
  (['title', 'titleSort', 'author', 'authorSort'] as const).forEach((field) => {
    const cleaned = collapseWhitespace(scalar[field]);
    if (cleaned !== scalar[field]) {
      issues.push({
        field,
        kind: 'whitespace',
        from: scalar[field],
        to: cleaned,
        autoEligible: true,
        changes: { [field]: cleaned },
      });
      scalar[field] = cleaned;
    }
  });

  // 2. HTML entities / mojibake on title & author.
  (['title', 'author'] as const).forEach((field) => {
    const v = scalar[field];
    if (hasEntity(v)) {
      const decoded = decodeEntities(v);
      if (decoded !== v) {
        issues.push({
          field,
          kind: 'html-entity',
          from: v,
          to: decoded,
          autoEligible: true,
          changes: { [field]: decoded },
        });
        scalar[field] = decoded;
      }
    }
    if (scalar[field].includes('�')) {
      issues.push({
        field,
        kind: 'html-entity',
        from: scalar[field],
        to: null,
        autoEligible: false,
        changes: {},
      });
    }
  });

  // 3. Missing spaces between author initials (author & authorSort).
  (['author', 'authorSort'] as const).forEach((field) => {
    if (!scalar[field]) return;
    const fixed = fixInitialSpacing(scalar[field]);
    if (fixed !== scalar[field]) {
      issues.push({
        field,
        kind: 'author-initials-spacing',
        from: scalar[field],
        to: fixed,
        autoEligible: true,
        changes: { [field]: fixed },
      });
      scalar[field] = fixed;
    }
  });

  // 4. Stray-comma-among-initials — guards de-invert.
  let deInvertGuarded = false;
  if (scalar.author && !MULTI_AUTHOR.test(scalar.author)) {
    const commaFixed = fixStrayInitialComma(scalar.author);
    if (commaFixed) {
      issues.push({
        field: 'author',
        kind: 'author-initials-comma',
        from: scalar.author,
        to: commaFixed,
        autoEligible: false,
        changes: { author: commaFixed },
      });
      deInvertGuarded = true;
    }
  }

  // 5. Author inverted "Last, First" -> "First Last" (auto).
  let authorSortResolved = false;
  if (!deInvertGuarded && scalar.author && !MULTI_AUTHOR.test(scalar.author)) {
    const parts = scalar.author.split(',');
    if (parts.length === 2) {
      const surname = parts[0].trim();
      const given = parts[1].trim();
      if (surname && given && !/\d/.test(scalar.author)) {
        const newAuthor = `${given} ${surname}`;
        const newSort = `${surname}, ${given}`;
        issues.push({
          field: 'author',
          kind: 'author-inverted',
          from: scalar.author,
          to: newAuthor,
          autoEligible: true,
          changes: { author: newAuthor, authorSort: newSort },
        });
        scalar.author = newAuthor;
        scalar.authorSort = newSort;
        authorSortResolved = true;
      }
    }
  }

  // 6. Author sort missing / present-but-wrong (only when author has no comma).
  if (!authorSortResolved && scalar.author && !scalar.author.includes(',')) {
    const derived = deriveAuthorSort(scalar.author);
    if (derived) {
      const auto = derived.auto && !MULTI_AUTHOR.test(scalar.author);
      if (scalar.authorSort === '') {
        issues.push({
          field: 'authorSort',
          kind: 'author-sort-missing',
          from: '',
          to: derived.value,
          autoEligible: auto,
          changes: { authorSort: derived.value },
        });
      } else if (
        /\s/.test(scalar.authorSort) &&
        !scalar.authorSort.includes(',') &&
        scalar.authorSort !== derived.value
      ) {
        issues.push({
          field: 'authorSort',
          kind: 'author-sort-wrong',
          from: scalar.authorSort,
          to: derived.value,
          autoEligible: auto,
          changes: { authorSort: derived.value },
        });
      }
    }
  }

  // 7. Title sort missing / wrong (leading article).
  const art = LEADING_ARTICLE.exec(scalar.title);
  if (art) {
    const correct = `${art[2].trim()}, ${art[1]}`;
    const sortStartsWithArticle = LEADING_ARTICLE.test(scalar.titleSort);
    if ((scalar.titleSort === '' || sortStartsWithArticle) && scalar.titleSort !== correct) {
      issues.push({
        field: 'titleSort',
        kind: 'title-sort-missing',
        from: scalar.titleSort,
        to: correct,
        autoEligible: true,
        changes: { titleSort: correct },
      });
    }
  }

  // 8. ALL CAPS title (proposal).
  if (isAllCaps(scalar.title)) {
    const tc = titleCase(scalar.title);
    if (tc !== scalar.title) {
      issues.push({
        field: 'title',
        kind: 'title-allcaps',
        from: scalar.title,
        to: tc,
        autoEligible: false,
        changes: { title: tc },
      });
    }
  }

  // 9. Title equals filename stem (flag only).
  if (
    input.filenameStem &&
    scalar.title.trim() !== '' &&
    scalar.title.trim() === input.filenameStem.trim()
  ) {
    issues.push({
      field: 'title',
      kind: 'title-is-filename',
      from: scalar.title,
      to: null,
      autoEligible: false,
      changes: {},
    });
  }

  // 10. Compound subjects — one fix per compound subject.
  const library = new Set((input.librarySubjects ?? []).map((s) => s.toLowerCase()));
  const subjects = Array.isArray(input.subjects) ? input.subjects : [];

  // subjects-split: one fix per compound subject so each can be applied/dismissed
  // individually. The split operation is carried by fromChips[0] -> toChips; the
  // final subjects array is computed at apply time from the book's current state.
  const seen = new Set<string>();
  subjects.forEach((subject) => {
    const parts = splitSubject(subject);
    if (parts.length < 2) return;
    if (seen.has(subject.toLowerCase())) return;
    seen.add(subject.toLowerCase());
    const dedupedParts = parts.filter(
      (p, i) => parts.findIndex((o) => o.toLowerCase() === p.toLowerCase()) === i
    );
    const allKnown = dedupedParts.every((p) => library.has(p.toLowerCase()));
    issues.push({
      field: 'subjects',
      kind: 'subjects-split',
      from: subject,
      to: dedupedParts.join(', '),
      autoEligible: false,
      reason: allKnown ? 'Both already exist in your library' : undefined,
      changes: {},
      fromChips: [subject],
      toChips: dedupedParts,
    });
  });

  return issues;
}
