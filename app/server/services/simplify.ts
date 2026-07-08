import { logger } from '../logger';

const log = logger('simplify');

type EntityReplacement = {
  regExp: RegExp;
  subject: string;
  replacement: string;
};

const quoteLevelHelper = (quoteLevel: number): string => {
  if (quoteLevel === 0) {
    return '1st-level';
  }
  if (quoteLevel === 1) {
    return '2nd-level';
  }
  if (quoteLevel === 2) {
    return '3rd-level';
  }
  return `${quoteLevel}th-level`;
};

export const entityReplacements: EntityReplacement[] = [
  { regExp: /&#8217;/g, subject: '&#8217;', replacement: '’' }, // right single quotation mark/apostrophe
  { regExp: /&#8230;/g, subject: '&#8230;', replacement: '…' }, // ellipsis
  { regExp: /&#8211;/g, subject: '&#8211;', replacement: '–' }, // en dash
  { regExp: /&#8212;/g, subject: '&#8212;', replacement: '—' }, // em dash
];

/**
 * Replace HTML entities with their actual characters
 *
 * @param content
 */
export const replaceEntities = (fileName: string, content: string): string => {
  entityReplacements.forEach((entity) => {
    let count = 0;
    content = content.replace(entity.regExp, () => {
      count++;
      return entity.replacement;
    });
    log.debug(`Simplifying ${fileName}: Replaced ${count} encoded ${entity.replacement}`);
  });

  return content;
};

/**
 * Replace <q> tags with quotes using a DOM-based approach This is more robust
 * than regex and handles nesting naturally
 *
 * @param content - The HTML content to process
 * @returns Content with <q> tags replaced by quotes
 */
export const replaceQuotes = (fileName: string, content: string): string => {
  if (!content) {
    return content;
  }

  // Use a regex-based approach to find and replace <q> tags
  // Track nesting level to alternate between double and single quotes
  // Use typographic quotes: " " for double quotes, ' ' for single quotes
  let result = '';
  let i = 0;
  let nestingLevel = 0;
  const openNestedCount: number[] = [];
  const closedNestedCount: number[] = [];

  while (i < content.length) {
    // Look for opening <q> tag (case-insensitive)
    const openTagMatch = content.slice(i).match(/^<q(?:\s[^>]*)?>/i);
    if (openTagMatch) {
      const isEvenLevel = nestingLevel % 2 === 0;
      const openQuote = isEvenLevel ? '“' : '‘'; // " or '
      result += openQuote;
      i += openTagMatch[0].length;
      nestingLevel++;
      openNestedCount[nestingLevel - 1] =
        openNestedCount[nestingLevel - 1] === undefined ? 0 : openNestedCount[nestingLevel - 1] + 1;
      continue;
    }

    // Look for closing </q> tag (case-insensitive)
    const closeTagMatch = content.slice(i).match(/^<\/q>/i);
    if (closeTagMatch) {
      nestingLevel = Math.max(0, nestingLevel - 1);
      const isEvenLevel = nestingLevel % 2 === 0;
      const closeQuote = isEvenLevel ? '”' : '’'; // " or '
      result += closeQuote;
      i += closeTagMatch[0].length;
      closedNestedCount[nestingLevel] =
        closedNestedCount[nestingLevel] === undefined ? 0 : closedNestedCount[nestingLevel] + 1;
      continue;
    }

    // Regular character
    result += content[i];
    i++;
  }

  for (let nestedIndex = 0; nestedIndex <= openNestedCount.length; nestedIndex++) {
    if (openNestedCount[nestedIndex] !== closedNestedCount[nestedIndex]) {
      log.warn(
        `A mismatched number of quote tags ${quoteLevelHelper(nestedIndex)} level quotes was detected in ${fileName}`
      );
    }
  }

  log.debug(
    `Simplifying ${fileName}: Replaced ${
      openNestedCount.length
        ? openNestedCount
            .map((count, index) => (count > 0 ? `${count} ${quoteLevelHelper(index)}` : undefined))
            .filter((count) => count !== undefined)
            .join(', ')
        : 0
    } <q>`
  );

  log.debug(
    `Simplifying ${fileName}: Replaced ${
      closedNestedCount.length
        ? closedNestedCount
            .map((count, index) => (count > 0 ? `${count} ${quoteLevelHelper(index)}` : undefined))
            .filter((count) => count !== undefined)
            .join(', ')
        : 0
    } </q>`
  );

  return result;
};

export const simplifyContent = (fileName: string, content: string): string => {
  let result = content;
  result = replaceEntities(fileName, content);
  result = replaceQuotes(fileName, result);
  return result;
};
