/**
 * Unicode security checks for the pre-scanner.
 * Detects BiDi attacks, invisible characters, and homograph attacks.
 *
 * @module pre-scanner/checks/unicode-check
 */

import type { PreScannerConfig } from '../config';
import type { ScanState } from '../scan-state';
import { PRESCANNER_ERROR_CODES } from '../errors';

/**
 * BiDi (Bidirectional) override characters used in Trojan Source attacks.
 * CVE-2021-42574: "Trojan Source: Invisible Vulnerabilities"
 *
 * These characters can be used to make code appear different than it actually executes.
 */
export const BIDI_OVERRIDE_CHARS = {
  // Explicit directional embeddings
  LRE: '\u202A', // Left-to-Right Embedding
  RLE: '\u202B', // Right-to-Left Embedding
  PDF: '\u202C', // Pop Directional Formatting

  // Explicit directional overrides
  LRO: '\u202D', // Left-to-Right Override
  RLO: '\u202E', // Right-to-Left Override

  // Explicit directional isolates (Unicode 6.3+)
  LRI: '\u2066', // Left-to-Right Isolate
  RLI: '\u2067', // Right-to-Left Isolate
  FSI: '\u2068', // First Strong Isolate
  PDI: '\u2069', // Pop Directional Isolate
} as const;

/**
 * All BiDi control characters to check for
 */
export const ALL_BIDI_CHARS = Object.values(BIDI_OVERRIDE_CHARS);

/**
 * Regex pattern matching any BiDi override character
 */
export const BIDI_PATTERN = new RegExp(`[${ALL_BIDI_CHARS.join('')}]`, 'g');

/**
 * Invisible/zero-width characters that can be used in attacks
 */
export const INVISIBLE_CHARS = {
  ZWSP: '\u200B', // Zero Width Space
  ZWNJ: '\u200C', // Zero Width Non-Joiner
  ZWJ: '\u200D', // Zero Width Joiner
  WORD_JOINER: '\u2060', // Word Joiner
  FEFF: '\uFEFF', // Zero Width No-Break Space (BOM)
  SHY: '\u00AD', // Soft Hyphen
  CGJ: '\u034F', // Combining Grapheme Joiner
} as const;

/**
 * All invisible characters to check for
 */
export const ALL_INVISIBLE_CHARS = Object.values(INVISIBLE_CHARS);

/**
 * Regex pattern matching invisible characters
 * Note: We allow ZWNJ and ZWJ in some contexts for legitimate use
 */
export const INVISIBLE_PATTERN = new RegExp(
  `[${[
    INVISIBLE_CHARS.ZWSP,
    INVISIBLE_CHARS.WORD_JOINER,
    INVISIBLE_CHARS.FEFF,
    INVISIBLE_CHARS.SHY,
    INVISIBLE_CHARS.CGJ,
  ].join('')}]`,
  'g',
);

/**
 * Check for BiDi override characters (Trojan Source attacks).
 *
 * These characters can make code appear visually different from what executes.
 * For example, RLO (Right-to-Left Override) can make "abc" display as "cba"
 * while still executing as "abc".
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkBidiPatterns(source: string, config: PreScannerConfig, state: ScanState): void {
  if (!config.blockBidiPatterns) {
    return;
  }

  BIDI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BIDI_PATTERN.exec(source)) !== null) {
    const position = match.index;
    const line = getLineNumber(source, position);
    const charCode = source.charCodeAt(position);
    const charName = getBidiCharName(charCode);

    state.incrementUnicodeIssues();
    state.reportFatalError({
      code: PRESCANNER_ERROR_CODES.BIDI_ATTACK,
      message: `Trojan Source attack detected: BiDi override character ${charName} (U+${charCode
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}) found`,
      position,
      line,
      data: {
        charCode,
        charName,
        attackType: 'trojan_source',
      },
    });
    return; // Stop on first detection
  }
}

/**
 * Check for invisible/zero-width characters.
 *
 * These characters can be used to:
 * - Create visually identical but different identifiers
 * - Hide malicious code within seemingly normal code
 * - Bypass security checks that match on visible text
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkInvisibleChars(source: string, config: PreScannerConfig, state: ScanState): void {
  if (!config.blockInvisibleChars) {
    return;
  }

  INVISIBLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  // Count invisible characters - allow a few (like BOM at start) but flag excessive use
  const matches: Array<{ position: number; charCode: number }> = [];

  while ((match = INVISIBLE_PATTERN.exec(source)) !== null) {
    const position = match.index;

    // Allow BOM at very start of file
    if (position === 0 && source.charCodeAt(0) === 0xfeff) {
      continue;
    }

    matches.push({
      position,
      charCode: source.charCodeAt(position),
    });
  }

  // Report if suspicious number of invisible chars (more than 3 is suspicious)
  if (matches.length > 3) {
    const firstMatch = matches[0];
    const line = getLineNumber(source, firstMatch.position);

    state.incrementUnicodeIssues();
    state.reportFatalError({
      code: PRESCANNER_ERROR_CODES.UNICODE_SUSPICIOUS,
      message: `Suspicious invisible characters detected: ${matches.length} invisible/zero-width characters found`,
      position: firstMatch.position,
      line,
      data: {
        count: matches.length,
        positions: matches.slice(0, 10).map((m) => m.position),
        attackType: 'invisible_chars',
      },
    });
  } else if (matches.length > 0) {
    // Warn about any invisible chars in code (not counting BOM)
    const firstMatch = matches[0];
    const line = getLineNumber(source, firstMatch.position);
    const charCode = firstMatch.charCode;

    state.incrementUnicodeIssues();
    state.reportWarning({
      code: PRESCANNER_ERROR_CODES.UNICODE_SUSPICIOUS,
      message: `Invisible character detected at position ${firstMatch.position} (U+${charCode
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')})`,
      position: firstMatch.position,
      line,
      data: {
        charCode,
        attackType: 'invisible_chars',
      },
    });
  }
}

/**
 * Check for homograph attacks using confusable characters.
 * This is a basic check for common confusables in identifiers.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkHomographs(source: string, config: PreScannerConfig, state: ScanState): void {
  if (!config.unicodePreCheck) {
    return;
  }

  // Common confusable pairs (ASCII lookalikes from other scripts)
  // These are characters that look like ASCII but are from different Unicode blocks
  const confusables: Array<{ char: string; lookalike: string; name: string }> = [
    // Cyrillic confusables
    { char: '\u0430', lookalike: 'a', name: 'Cyrillic small a' },
    { char: '\u0435', lookalike: 'e', name: 'Cyrillic small ie' },
    { char: '\u043E', lookalike: 'o', name: 'Cyrillic small o' },
    { char: '\u0440', lookalike: 'p', name: 'Cyrillic small er' },
    { char: '\u0441', lookalike: 'c', name: 'Cyrillic small es' },
    { char: '\u0445', lookalike: 'x', name: 'Cyrillic small ha' },
    { char: '\u0443', lookalike: 'y', name: 'Cyrillic small u' },
    // Greek confusables
    { char: '\u03B1', lookalike: 'a', name: 'Greek small alpha' },
    { char: '\u03BF', lookalike: 'o', name: 'Greek small omicron' },
    // Full-width ASCII
    { char: '\uFF41', lookalike: 'a', name: 'Fullwidth small a' },
    { char: '\uFF45', lookalike: 'e', name: 'Fullwidth small e' },
  ];

  for (const { char, lookalike, name } of confusables) {
    const index = source.indexOf(char);
    if (index !== -1) {
      const line = getLineNumber(source, index);
      const charCode = char.charCodeAt(0);

      state.incrementUnicodeIssues();
      state.reportFatalError({
        code: PRESCANNER_ERROR_CODES.HOMOGRAPH_ATTACK,
        message: `Homograph attack detected: ${name} (U+${charCode
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}) looks like ASCII '${lookalike}'`,
        position: index,
        line,
        data: {
          charCode,
          confusedWith: lookalike,
          charName: name,
          attackType: 'homograph',
        },
      });
      return; // Stop on first detection
    }
  }
}

/**
 * Perform all Unicode security checks.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function performUnicodeChecks(source: string, config: PreScannerConfig, state: ScanState): void {
  // Only run if unicode pre-check is enabled
  if (!config.unicodePreCheck) {
    return;
  }

  // Check for BiDi attacks (most critical)
  checkBidiPatterns(source, config, state);
  if (state.shouldStop()) return;

  // Check for invisible characters
  checkInvisibleChars(source, config, state);
  if (state.shouldStop()) return;

  // Check for homograph attacks
  checkHomographs(source, config, state);
}

/**
 * Get line number for a position in source
 */
function getLineNumber(source: string, position: number): number {
  let line = 1;
  for (let i = 0; i < position && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * Get human-readable name for BiDi character code
 */
function getBidiCharName(charCode: number): string {
  const names: Record<number, string> = {
    0x202a: 'LRE (Left-to-Right Embedding)',
    0x202b: 'RLE (Right-to-Left Embedding)',
    0x202c: 'PDF (Pop Directional Formatting)',
    0x202d: 'LRO (Left-to-Right Override)',
    0x202e: 'RLO (Right-to-Left Override)',
    0x2066: 'LRI (Left-to-Right Isolate)',
    0x2067: 'RLI (Right-to-Left Isolate)',
    0x2068: 'FSI (First Strong Isolate)',
    0x2069: 'PDI (Pop Directional Isolate)',
  };
  return names[charCode] || `Unknown (${charCode.toString(16)})`;
}
