import * as walk from 'acorn-walk';
import { ValidationRule, ValidationContext, ValidationSeverity } from '../interfaces';

/**
 * Unicode attack categories and their character ranges
 */
const UNICODE_ATTACK_PATTERNS = {
  /**
   * Zero-width characters that can hide malicious code
   * - Zero Width Space (U+200B)
   * - Zero Width Non-Joiner (U+200C)
   * - Zero Width Joiner (U+200D)
   * - Word Joiner (U+2060)
   * - Zero Width No-Break Space (U+FEFF) - BOM
   */
  zeroWidth: /[\u200B\u200C\u200D\u2060\uFEFF]/,

  /**
   * Bidirectional text control characters (Trojan Source attacks)
   * These can reverse the visual order of code, hiding malicious logic
   * - Left-to-Right Override (U+202D)
   * - Right-to-Left Override (U+202E)
   * - Left-to-Right Embedding (U+202A)
   * - Right-to-Left Embedding (U+202B)
   * - Pop Directional Formatting (U+202C)
   * - Left-to-Right Isolate (U+2066)
   * - Right-to-Left Isolate (U+2067)
   * - First Strong Isolate (U+2068)
   * - Pop Directional Isolate (U+2069)
   * - Left-to-Right Mark (U+200E)
   * - Right-to-Left Mark (U+200F)
   */
  bidi: /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/,

  /**
   * Homoglyph characters - look like ASCII but are different
   * Common confusables from various scripts that look like Latin letters
   */
  homoglyphPatterns: {
    // Cyrillic homoglyphs (most common attack vector)
    cyrillic: {
      а: 'a', // Cyrillic Small Letter A (U+0430)
      е: 'e', // Cyrillic Small Letter Ie (U+0435)
      о: 'o', // Cyrillic Small Letter O (U+043E)
      р: 'p', // Cyrillic Small Letter Er (U+0440)
      с: 'c', // Cyrillic Small Letter Es (U+0441)
      х: 'x', // Cyrillic Small Letter Ha (U+0445)
      у: 'y', // Cyrillic Small Letter U (U+0443)
      А: 'A', // Cyrillic Capital Letter A (U+0410)
      В: 'B', // Cyrillic Capital Letter Ve (U+0412)
      Е: 'E', // Cyrillic Capital Letter Ie (U+0415)
      К: 'K', // Cyrillic Capital Letter Ka (U+041A)
      М: 'M', // Cyrillic Capital Letter Em (U+041C)
      Н: 'H', // Cyrillic Capital Letter En (U+041D)
      О: 'O', // Cyrillic Capital Letter O (U+041E)
      Р: 'P', // Cyrillic Capital Letter Er (U+0420)
      С: 'C', // Cyrillic Capital Letter Es (U+0421)
      Т: 'T', // Cyrillic Capital Letter Te (U+0422)
      Х: 'X', // Cyrillic Capital Letter Ha (U+0425)
    } as Record<string, string>,
    // Greek homoglyphs
    greek: {
      Α: 'A', // Greek Capital Letter Alpha (U+0391)
      Β: 'B', // Greek Capital Letter Beta (U+0392)
      Ε: 'E', // Greek Capital Letter Epsilon (U+0395)
      Η: 'H', // Greek Capital Letter Eta (U+0397)
      Ι: 'I', // Greek Capital Letter Iota (U+0399)
      Κ: 'K', // Greek Capital Letter Kappa (U+039A)
      Μ: 'M', // Greek Capital Letter Mu (U+039C)
      Ν: 'N', // Greek Capital Letter Nu (U+039D)
      Ο: 'O', // Greek Capital Letter Omicron (U+039F)
      Ρ: 'P', // Greek Capital Letter Rho (U+03A1)
      Τ: 'T', // Greek Capital Letter Tau (U+03A4)
      Χ: 'X', // Greek Capital Letter Chi (U+03A7)
      Υ: 'Y', // Greek Capital Letter Upsilon (U+03A5)
      Ζ: 'Z', // Greek Capital Letter Zeta (U+0396)
      ο: 'o', // Greek Small Letter Omicron (U+03BF)
      ν: 'v', // Greek Small Letter Nu (U+03BD) - looks like v
    } as Record<string, string>,
    // Mathematical/Symbol homoglyphs
    mathematical: {
      '℮': 'e', // Estimated Symbol (U+212E)
      '⁰': '0', // Superscript Zero (U+2070)
      '¹': '1', // Superscript One (U+00B9)
      '²': '2', // Superscript Two (U+00B2)
      '³': '3', // Superscript Three (U+00B3)
      ℹ: 'i', // Information Source (U+2139)
      '⁴': '4', // Superscript Four (U+2074)
      '⁵': '5', // Superscript Five (U+2075)
      '⁶': '6', // Superscript Six (U+2076)
      '⁷': '7', // Superscript Seven (U+2077)
      '⁸': '8', // Superscript Eight (U+2078)
      '⁹': '9', // Superscript Nine (U+2079)
    } as Record<string, string>,
    // Fullwidth characters (common in Asian attacks)
    fullwidth: {
      ａ: 'a',
      ｂ: 'b',
      ｃ: 'c',
      ｄ: 'd',
      ｅ: 'e',
      ｆ: 'f',
      ｇ: 'g',
      ｈ: 'h',
      ｉ: 'i',
      ｊ: 'j',
      ｋ: 'k',
      ｌ: 'l',
      ｍ: 'm',
      ｎ: 'n',
      ｏ: 'o',
      ｐ: 'p',
      ｑ: 'q',
      ｒ: 'r',
      ｓ: 's',
      ｔ: 't',
      ｕ: 'u',
      ｖ: 'v',
      ｗ: 'w',
      ｘ: 'x',
      ｙ: 'y',
      ｚ: 'z',
      Ａ: 'A',
      Ｂ: 'B',
      Ｃ: 'C',
      Ｄ: 'D',
      Ｅ: 'E',
      Ｆ: 'F',
      Ｇ: 'G',
      Ｈ: 'H',
      Ｉ: 'I',
      Ｊ: 'J',
      Ｋ: 'K',
      Ｌ: 'L',
      Ｍ: 'M',
      Ｎ: 'N',
      Ｏ: 'O',
      Ｐ: 'P',
      Ｑ: 'Q',
      Ｒ: 'R',
      Ｓ: 'S',
      Ｔ: 'T',
      Ｕ: 'U',
      Ｖ: 'V',
      Ｗ: 'W',
      Ｘ: 'X',
      Ｙ: 'Y',
      Ｚ: 'Z',
      '０': '0',
      '１': '1',
      '２': '2',
      '３': '3',
      '４': '4',
      '５': '5',
      '６': '6',
      '７': '7',
      '８': '8',
      '９': '9',
    } as Record<string, string>,
  },

  /**
   * Invisible/formatting characters that can hide code
   */
  invisible: /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u3164\uFFA0]/,

  /**
   * Tag characters (U+E0000-U+E007F) - can be used to hide data
   */
  tagCharacters: /[\uE0000-\uE007F]/u,
};

/**
 * Options for UnicodeSecurityRule
 */
export interface UnicodeSecurityOptions {
  /** Block zero-width characters (default: true) */
  blockZeroWidth?: boolean;
  /** Block bidirectional control characters (default: true) */
  blockBidi?: boolean;
  /** Block homoglyph characters in identifiers (default: true) */
  blockHomoglyphs?: boolean;
  /** Block invisible/formatting characters (default: true) */
  blockInvisible?: boolean;
  /** Allow specific Unicode characters (whitelist) */
  allowedCharacters?: string[];
  /** Check string literals for Unicode attacks (default: false) */
  checkStringLiterals?: boolean;
  /** Check template literals for Unicode attacks (default: false) */
  checkTemplateLiterals?: boolean;
  /** Check comments for Unicode attacks (default: true for bidi) */
  checkComments?: boolean;
}

/**
 * Information about a detected Unicode attack
 */
interface UnicodeViolation {
  type: 'zero-width' | 'bidi' | 'homoglyph' | 'invisible';
  character: string;
  codePoint: string;
  lookalike?: string;
  position: number;
}

/**
 * Rule that detects and blocks Unicode-based attacks
 *
 * This rule protects against:
 * 1. **Trojan Source attacks** - Bidirectional text control characters
 *    that can visually reorder code to hide malicious logic
 * 2. **Homoglyph attacks** - Characters that look like ASCII but are
 *    different (e.g., Cyrillic 'а' vs Latin 'a')
 * 3. **Zero-width injection** - Invisible characters that can hide
 *    in identifiers or strings
 * 4. **Invisible character attacks** - Formatting characters that
 *    don't render but affect string comparisons
 *
 * @example
 * ```typescript
 * // Trojan Source attack - bidi override makes code look different
 * // Code with U+202E (RLO) visually reverses text direction
 *
 * // Homoglyph attack - Cyrillic U+0430 looks like Latin 'a'
 * // const \u0430dmin = true;  // looks like "admin" but is different
 *
 * // Zero-width injection
 * // const x = "hello\u200Bworld";  // Invisible ZWSP in string
 * ```
 */
export class UnicodeSecurityRule implements ValidationRule {
  readonly name = 'unicode-security';
  readonly description = 'Detects Unicode-based security attacks (homoglyphs, bidi, zero-width)';
  readonly defaultSeverity = ValidationSeverity.ERROR;
  readonly enabledByDefault = true;

  private options: Required<
    Omit<UnicodeSecurityOptions, 'allowedCharacters'> & {
      allowedCharacters: Set<string>;
    }
  >;

  private allHomoglyphs: Map<string, string>;

  constructor(options: UnicodeSecurityOptions = {}) {
    this.options = {
      blockZeroWidth: options.blockZeroWidth !== false,
      blockBidi: options.blockBidi !== false,
      blockHomoglyphs: options.blockHomoglyphs !== false,
      blockInvisible: options.blockInvisible !== false,
      allowedCharacters: new Set(options.allowedCharacters || []),
      checkStringLiterals: options.checkStringLiterals || false,
      checkTemplateLiterals: options.checkTemplateLiterals || false,
      checkComments: options.checkComments !== false,
    };

    // Build combined homoglyph map
    this.allHomoglyphs = new Map();
    for (const category of Object.values(UNICODE_ATTACK_PATTERNS.homoglyphPatterns)) {
      for (const [homoglyph, ascii] of Object.entries(category)) {
        this.allHomoglyphs.set(homoglyph, ascii);
      }
    }
  }

  validate(context: ValidationContext): void {
    const sourceCode = context.source;

    // Check raw source for bidi characters (can be in comments)
    if (this.options.blockBidi && this.options.checkComments) {
      this.checkSourceForBidi(sourceCode, context);
    }

    // Walk AST for identifiers and literals using walk.full to catch ALL nodes
    // (walk.simple doesn't visit certain nodes like VariableDeclarator.id)
    walk.full(context.ast as any, (node: any) => {
      switch (node.type) {
        case 'Identifier':
          this.checkString(node.name, node, 'identifier', context);
          break;
        case 'Literal':
          if (typeof node.value === 'string' && this.options.checkStringLiterals) {
            this.checkString(node.value, node, 'string literal', context);
          }
          break;
        case 'TemplateElement':
          if (this.options.checkTemplateLiterals && node.value?.raw) {
            this.checkString(node.value.raw, node, 'template literal', context);
          }
          break;
        case 'Property':
          // Check property names in object literals
          if (node.key) {
            if (node.key.type === 'Identifier') {
              this.checkString(node.key.name, node.key, 'property name', context);
            } else if (node.key.type === 'Literal' && typeof node.key.value === 'string') {
              this.checkString(node.key.value, node.key, 'property name', context);
            }
          }
          break;
      }
    });
  }

  /**
   * Check source code for bidirectional control characters
   * These can appear in comments and are not visible in the AST
   */
  private checkSourceForBidi(source: string, context: ValidationContext): void {
    const bidiPattern = UNICODE_ATTACK_PATTERNS.bidi;
    let match;
    const globalPattern = new RegExp(bidiPattern.source, 'g');

    while ((match = globalPattern.exec(source)) !== null) {
      const char = match[0];
      if (this.options.allowedCharacters.has(char)) continue;

      const position = match.index;
      const { line, column } = this.getLineAndColumn(source, position);

      context.report({
        code: 'UNICODE_BIDI_ATTACK',
        message: `Bidirectional control character detected (U+${char
          .charCodeAt(0)
          .toString(16)
          .toUpperCase()
          .padStart(4, '0')}). This can be used for Trojan Source attacks.`,
        location: { line, column },
        data: {
          type: 'bidi',
          codePoint: `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
        },
      });
    }
  }

  /**
   * Check a string for Unicode security issues
   */
  private checkString(str: string, node: any, contextType: string, context: ValidationContext): void {
    const violations = this.detectViolations(str);

    for (const violation of violations) {
      if (this.options.allowedCharacters.has(violation.character)) continue;

      let message: string;
      let code: string;

      switch (violation.type) {
        case 'zero-width':
          if (!this.options.blockZeroWidth) continue;
          code = 'UNICODE_ZERO_WIDTH';
          message = `Zero-width character detected in ${contextType} at position ${violation.position} (${violation.codePoint}). This can hide malicious code.`;
          break;

        case 'bidi':
          if (!this.options.blockBidi) continue;
          code = 'UNICODE_BIDI_ATTACK';
          message = `Bidirectional control character detected in ${contextType} (${violation.codePoint}). This can be used for Trojan Source attacks.`;
          break;

        case 'homoglyph':
          if (!this.options.blockHomoglyphs) continue;
          code = 'UNICODE_HOMOGLYPH';
          message = `Homoglyph character '${violation.character}' (${violation.codePoint}) detected in ${contextType}. Looks like '${violation.lookalike}' but is a different character.`;
          break;

        case 'invisible':
          if (!this.options.blockInvisible) continue;
          code = 'UNICODE_INVISIBLE';
          message = `Invisible/formatting character detected in ${contextType} (${violation.codePoint}). This can hide malicious content.`;
          break;
      }

      context.report({
        code,
        message,
        location: node.loc
          ? {
              line: node.loc.start.line,
              column: node.loc.start.column + violation.position,
            }
          : undefined,
        data: {
          type: violation.type,
          character: violation.character,
          codePoint: violation.codePoint,
          lookalike: violation.lookalike,
          contextType,
        },
      });
    }
  }

  /**
   * Detect all Unicode violations in a string
   */
  private detectViolations(str: string): UnicodeViolation[] {
    const violations: UnicodeViolation[] = [];

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const codePoint = `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

      // Check zero-width
      if (UNICODE_ATTACK_PATTERNS.zeroWidth.test(char)) {
        violations.push({
          type: 'zero-width',
          character: char,
          codePoint,
          position: i,
        });
        continue;
      }

      // Check bidi
      if (UNICODE_ATTACK_PATTERNS.bidi.test(char)) {
        violations.push({
          type: 'bidi',
          character: char,
          codePoint,
          position: i,
        });
        continue;
      }

      // Check invisible
      if (UNICODE_ATTACK_PATTERNS.invisible.test(char)) {
        violations.push({
          type: 'invisible',
          character: char,
          codePoint,
          position: i,
        });
        continue;
      }

      // Check homoglyphs
      const lookalike = this.allHomoglyphs.get(char);
      if (lookalike) {
        violations.push({
          type: 'homoglyph',
          character: char,
          codePoint,
          lookalike,
          position: i,
        });
      }
    }

    return violations;
  }

  /**
   * Convert a character position to line and column numbers
   */
  private getLineAndColumn(source: string, position: number): { line: number; column: number } {
    const lines = source.slice(0, position).split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length,
    };
  }
}

/**
 * Helper function to normalize a string by replacing homoglyphs with ASCII equivalents
 * Useful for comparison or logging purposes
 */
export function normalizeHomoglyphs(str: string): string {
  let result = '';
  const allHomoglyphs = new Map<string, string>();

  for (const category of Object.values(UNICODE_ATTACK_PATTERNS.homoglyphPatterns)) {
    for (const [homoglyph, ascii] of Object.entries(category)) {
      allHomoglyphs.set(homoglyph, ascii);
    }
  }

  for (const char of str) {
    const replacement = allHomoglyphs.get(char);
    result += replacement || char;
  }

  return result;
}

/**
 * Helper function to detect if a string contains any Unicode security issues
 * Returns true if the string is safe, false if it contains suspicious characters
 */
export function isUnicodeSafe(str: string): boolean {
  // Check all attack patterns
  if (UNICODE_ATTACK_PATTERNS.zeroWidth.test(str)) return false;
  if (UNICODE_ATTACK_PATTERNS.bidi.test(str)) return false;
  if (UNICODE_ATTACK_PATTERNS.invisible.test(str)) return false;

  // Check for homoglyphs
  const allHomoglyphs = new Map<string, string>();
  for (const category of Object.values(UNICODE_ATTACK_PATTERNS.homoglyphPatterns)) {
    for (const [homoglyph, ascii] of Object.entries(category)) {
      allHomoglyphs.set(homoglyph, ascii);
    }
  }

  for (const char of str) {
    if (allHomoglyphs.has(char)) return false;
  }

  return true;
}
