/** Where a module specifier sits in a source: its text, between the quotes at `start` and `end`. */
export interface ModuleSpecifierRange {
  start: number;
  end: number;
  specifier: string;
}

const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

const WORD_START = /[A-Za-z_$]/;
const WORD_PART = /[A-Za-z0-9_$]/;
const WHITESPACE = /\s/;

/**
 * Finds the specifiers of static imports, re-exports (`from '…'`) and dynamic imports (`import('…')`)
 * in JavaScript source. Strings, comments, template literals and regex literals are skipped, so text
 * that only looks like an import is never reported.
 */
export function findModuleSpecifiers(source: string): ModuleSpecifierRange[] {
  const ranges: ModuleSpecifierRange[] = [];
  const templateBraceDepths: number[] = [];
  let braceDepth = 0;
  let regexAllowed = true;
  let previousCodeChar = '';
  let index = 0;
  let previousToken = '';
  let tokenBeforePrevious = '';

  const pushToken = (token: string): void => {
    tokenBeforePrevious = previousToken;
    previousToken = token;
  };

  // `from` names a module only after an import/export clause: `}`, `*`, or a binding after `import`/`as`
  const fromEndsImportClause = (): boolean =>
    previousToken === '}' ||
    previousToken === '*' ||
    (WORD_START.test(previousToken.charAt(0)) && (tokenBeforePrevious === 'import' || tokenBeforePrevious === 'as'));

  const skipQuoted = (from: number): number => {
    const quote = source[from];
    let position = from + 1;
    while (position < source.length && source[position] !== quote && source[position] !== '\n') {
      position += source[position] === '\\' ? 2 : 1;
    }
    return position + 1;
  };

  const continueTemplate = (from: number): number => {
    let position = from;
    while (position < source.length) {
      const char = source[position];
      if (char === '\\') {
        position += 2;
      } else if (char === '`') {
        regexAllowed = false;
        return position + 1;
      } else if (char === '$' && source[position + 1] === '{') {
        templateBraceDepths.push(braceDepth);
        regexAllowed = true;
        return position + 2;
      } else {
        position += 1;
      }
    }
    return position;
  };

  const skipRegex = (from: number): number => {
    let position = from + 1;
    let inCharacterClass = false;
    while (position < source.length && source[position] !== '\n') {
      const char = source[position];
      if (char === '\\') {
        position += 2;
        continue;
      }
      if (char === '[') inCharacterClass = true;
      else if (char === ']') inCharacterClass = false;
      else if (char === '/' && !inCharacterClass) {
        position += 1;
        while (position < source.length && WORD_PART.test(source[position])) position += 1;
        return position;
      }
      position += 1;
    }
    return position;
  };

  const skipWhitespaceAndComments = (from: number): number => {
    let position = from;
    while (position < source.length) {
      if (WHITESPACE.test(source[position])) {
        position += 1;
      } else if (source.startsWith('//', position)) {
        const lineEnd = source.indexOf('\n', position);
        position = lineEnd === -1 ? source.length : lineEnd;
      } else if (source.startsWith('/*', position)) {
        const commentEnd = source.indexOf('*/', position + 2);
        position = commentEnd === -1 ? source.length : commentEnd + 2;
      } else {
        return position;
      }
    }
    return position;
  };

  const recordSpecifierAt = (from: number): void => {
    const quote = source[from];
    if (quote !== '"' && quote !== "'") return;
    const end = skipQuoted(from) - 1;
    if (source[end] !== quote) return;
    ranges.push({ start: from + 1, end, specifier: source.slice(from + 1, end) });
  };

  while (index < source.length) {
    const char = source[index];

    if (WHITESPACE.test(char)) {
      index += 1;
      continue;
    }
    if (source.startsWith('//', index) || source.startsWith('/*', index)) {
      index = skipWhitespaceAndComments(index);
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipQuoted(index);
      regexAllowed = false;
      previousCodeChar = char;
      pushToken(char);
      continue;
    }
    if (char === '`') {
      index = continueTemplate(index + 1);
      previousCodeChar = char;
      pushToken(char);
      continue;
    }
    if (char === '}' && templateBraceDepths[templateBraceDepths.length - 1] === braceDepth) {
      templateBraceDepths.pop();
      index = continueTemplate(index + 1);
      previousCodeChar = '`';
      pushToken('`');
      continue;
    }
    if (char === '/' && regexAllowed) {
      index = skipRegex(index);
      regexAllowed = false;
      previousCodeChar = '/';
      pushToken('/');
      continue;
    }
    if (WORD_START.test(char)) {
      let wordEnd = index + 1;
      while (wordEnd < source.length && WORD_PART.test(source[wordEnd])) wordEnd += 1;
      const word = source.slice(index, wordEnd);
      const namesModule = word === 'import' || (word === 'from' && fromEndsImportClause());
      if (namesModule && previousCodeChar !== '.') {
        let specifierStart = skipWhitespaceAndComments(wordEnd);
        if (word === 'import' && source[specifierStart] === '(') {
          specifierStart = skipWhitespaceAndComments(specifierStart + 1);
        }
        recordSpecifierAt(specifierStart);
      }
      regexAllowed = KEYWORDS_BEFORE_REGEX.has(word);
      previousCodeChar = 'a';
      pushToken(word);
      index = wordEnd;
      continue;
    }

    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    regexAllowed = char !== ')' && char !== ']' && !/[0-9]/.test(char);
    previousCodeChar = char;
    pushToken(char);
    index += 1;
  }

  return ranges;
}
