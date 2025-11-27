/**
 * Unicode Security Rule Tests
 *
 * Tests for detecting Unicode-based attacks including:
 * - Trojan Source (bidirectional text attacks)
 * - Homoglyph attacks (Cyrillic, Greek, fullwidth)
 * - Zero-width character injection
 * - Invisible character attacks
 *
 * NOTE: Some dangerous characters (ZWSP, bidi controls, soft hyphen) are rejected
 * by acorn's parser when used in identifiers. These are blocked at parse time,
 * not by our rule. Our rule catches characters that acorn accepts but are dangerous.
 */

import { JSAstValidator } from '../validator';
import { UnicodeSecurityRule, normalizeHomoglyphs, isUnicodeSafe } from '../rules/unicode-security.rule';

// Disable pre-scanner for all AST rule tests - we're testing the AST rules specifically
const disablePreScan = { preScan: { enabled: false } };

describe('UnicodeSecurityRule', () => {
  describe('Homoglyph Detection', () => {
    describe('Cyrillic Homoglyphs', () => {
      it('should detect Cyrillic "а" (U+0430) vs Latin "a"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        // Using Cyrillic 'а' (U+0430) which looks like Latin 'a'
        const code = 'const \u0430dmin = true;'; // аdmin with Cyrillic а
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
        expect(result.issues.some((i) => i.message?.includes("'a'"))).toBe(true);
      });

      it('should detect Cyrillic "е" (U+0435) vs Latin "e"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const \u0435vil = true;'; // еvil with Cyrillic е
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect Cyrillic "о" (U+043E) vs Latin "o"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const c\u043Ede = 123;'; // cоde with Cyrillic о
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect Cyrillic "р" (U+0440) vs Latin "p"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const \u0440ass = "secret";'; // рass with Cyrillic р
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect Cyrillic "с" (U+0441) vs Latin "c"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const se\u0441ret = 42;'; // seсret with Cyrillic с
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect Cyrillic Capital letters', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const \u0410dmin = true;'; // Аdmin with Cyrillic А (U+0410)
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });
    });

    describe('Greek Homoglyphs', () => {
      it('should detect Greek "ο" (U+03BF) vs Latin "o"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const c\u03BFde = 123;'; // cοde with Greek ο
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect Greek Capital Alpha vs Latin "A"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const \u0391dmin = true;'; // Αdmin with Greek Α (U+0391)
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect Greek "ν" (U+03BD) vs Latin "v"', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const e\u03BDil = true;'; // eνil with Greek ν
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });
    });

    describe('Fullwidth Homoglyphs', () => {
      it('should detect fullwidth letters', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const \uFF41dmin = true;'; // ａdmin with fullwidth ａ (U+FF41)
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });

      it('should detect fullwidth digits', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule()]);
        const code = 'const x\uFF10 = 123;'; // x０ with fullwidth ０ (U+FF10)
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });
    });

    describe('Mathematical Symbol Homoglyphs', () => {
      it('should detect superscript digits in string literals when enabled', async () => {
        const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
        // Superscript digits cause parse errors in identifiers, test in string
        const code = 'const x = "x\u00B9y";'; // "x¹y" with superscript ¹
        const result = await validator.validate(code, disablePreScan);

        expect(result.valid).toBe(false);
        expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
      });
    });
  });

  describe('Bidirectional Text Attacks (Trojan Source)', () => {
    // Note: Bidi characters in identifiers cause parse errors in acorn.
    // These tests verify behavior in comments and strings where bidi is still dangerous.

    it('should detect bidi in source code/comments when checkComments is enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkComments: true })]);
      // Bidi in a comment (after valid code)
      const code = 'const x = 1; // Comment with \u202E bidi';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_BIDI_ATTACK')).toBe(true);
      expect(result.issues.some((i) => i.message?.includes('Trojan Source'))).toBe(true);
    });

    it('should detect RLO (U+202E) in source comments', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkComments: true })]);
      const code = '/* \u202E hidden */ const x = 1;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_BIDI_ATTACK')).toBe(true);
    });

    it('should detect LRO (U+202D) in source comments', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkComments: true })]);
      const code = '// \u202D comment\nconst x = 1;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_BIDI_ATTACK')).toBe(true);
    });

    it('should detect bidi isolates in source', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkComments: true })]);
      const code = '// Test \u2067 isolate\nconst x = 1;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_BIDI_ATTACK')).toBe(true);
    });

    it('should not check comments by default when checkComments is false', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkComments: false })]);
      const code = 'const x = 1; // Comment with \u202E bidi';
      const result = await validator.validate(code, disablePreScan);

      // Bidi in comments only checked when checkComments is true
      expect(result.valid).toBe(true);
    });
  });

  describe('Zero-Width Characters in Identifiers', () => {
    // Note: ZWSP (U+200B) causes parse errors. ZWNJ (U+200C) and ZWJ (U+200D) are accepted.

    it('should detect ZWNJ (U+200C) in identifiers', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x\u200Cy = 1;'; // x‌y with ZWNJ
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
    });

    it('should detect ZWJ (U+200D) in identifiers', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x\u200Dy = 1;'; // x‍y with ZWJ
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
    });

    it('should detect ZWSP (U+200B) in strings when checkStringLiterals is enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "hello\u200Bworld";'; // ZWSP in string
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
      expect(result.issues.some((i) => i.message?.includes('hide malicious code'))).toBe(true);
    });

    it('should detect Word Joiner (U+2060) in strings when checkStringLiterals is enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "hello\u2060world";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
    });

    it('should detect BOM/ZWNBSP (U+FEFF) in strings', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "\uFEFFhello";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
    });
  });

  describe('Invisible Characters in Strings', () => {
    // These characters cause parse errors in identifiers, test in strings

    it('should detect Soft Hyphen (U+00AD) in strings when enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "hello\u00ADworld";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_INVISIBLE')).toBe(true);
    });

    it('should detect Combining Grapheme Joiner (U+034F) in strings', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "test\u034Fvalue";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_INVISIBLE')).toBe(true);
    });

    it('should detect Arabic Letter Mark (U+061C) in strings', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "test\u061Cvalue";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_INVISIBLE')).toBe(true);
    });

    it('should detect Hangul Filler (U+3164) in strings', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "test\u3164value";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_INVISIBLE')).toBe(true);
    });
  });

  describe('String Literal Checking', () => {
    it('should not check string literals by default', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x = "\u200B";'; // ZWSP in string
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });

    it('should check string literals when enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "hello\u200Bworld";'; // ZWSP in string
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
    });

    it('should detect homoglyphs in string literals when enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkStringLiterals: true })]);
      const code = 'const x = "\u0430dmin";'; // Cyrillic а in string
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
    });
  });

  describe('Template Literal Checking', () => {
    it('should not check template literals by default', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x = `hello\u200Bworld`;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });

    it('should check template literals when enabled', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkTemplateLiterals: true })]);
      const code = 'const x = `hello\u200Bworld`;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_ZERO_WIDTH')).toBe(true);
    });
  });

  describe('Property Name Checking', () => {
    it('should detect homoglyphs in object property names', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const obj = { \u0430dmin: true };'; // Cyrillic а
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
    });

    it('should detect homoglyphs in quoted property names', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const obj = { "\u0430dmin": true };'; // Cyrillic а in quoted key
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
    });
  });

  describe('Configuration Options', () => {
    it('should allow disabling zero-width detection', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ blockZeroWidth: false })]);
      const code = 'const x\u200Cy = 1;'; // ZWNJ (which acorn accepts)
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });

    it('should allow disabling homoglyph detection', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ blockHomoglyphs: false })]);
      const code = 'const \u0430dmin = true;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });

    it('should allow disabling invisible character detection in strings', async () => {
      const validator = new JSAstValidator([
        new UnicodeSecurityRule({ blockInvisible: false, checkStringLiterals: true }),
      ]);
      const code = 'const x = "hello\u00ADworld";'; // Soft hyphen in string
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });

    it('should allow whitelisting specific characters', async () => {
      const validator = new JSAstValidator([
        new UnicodeSecurityRule({ allowedCharacters: ['\u200C'] }), // Whitelist ZWNJ
      ]);
      const code = 'const x\u200Cy = 1;'; // ZWNJ is whitelisted
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });
  });

  describe('Real-World Attack Scenarios', () => {
    it('should detect "admin" spoofed with Cyrillic', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      // Cyrillic а (U+0430) looks like Latin a
      const code = 'const \u0430dmin = true;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_HOMOGLYPH')).toBe(true);
    });

    it('should detect hidden code via ZWNJ/ZWJ in identifiers', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      // Variable that looks like "test" but has hidden ZWNJ characters
      const code = 'const t\u200Ce\u200Cs\u200Ct = 1;';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.filter((i) => i.code === 'UNICODE_ZERO_WIDTH').length).toBe(3);
    });

    it('should detect visual spoofing attack on password variables', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      // "password" with Cyrillic 'а' and 'о'
      const code = 'const p\u0430ssw\u043Erd = "secret";';
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.filter((i) => i.code === 'UNICODE_HOMOGLYPH').length).toBe(2);
    });

    it('should detect Trojan Source in multi-line comment', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule({ checkComments: true })]);
      const code = `
        /*
         * This is a normal comment
         * \u202E But this line has hidden bidi
         */
        const x = 1;
      `;
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'UNICODE_BIDI_ATTACK')).toBe(true);
    });
  });

  describe('Clean Code Passes', () => {
    it('should allow clean ASCII identifiers', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = `
        const admin = true;
        const password = 'secret';
        function test() { return 42; }
      `;
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should allow legitimate unicode in strings by default', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = `
        const greeting = "Hello, 世界!";
        const emoji = "🎉";
        const arabic = "مرحبا";
      `;
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(true);
    });
  });

  describe('Parser-Level Blocking', () => {
    // These tests document that certain characters cause parse errors
    // before our rule even runs. This is defense-in-depth.

    it('should reject ZWSP in identifiers at parse level', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x\u200By = 1;'; // ZWSP causes parse error
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'PARSE_ERROR')).toBe(true);
    });

    it('should reject bidi override in identifiers at parse level', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x\u202E = 1;'; // RLO causes parse error in identifier
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'PARSE_ERROR')).toBe(true);
    });

    it('should reject soft hyphen in identifiers at parse level', async () => {
      const validator = new JSAstValidator([new UnicodeSecurityRule()]);
      const code = 'const x\u00ADy = 1;'; // Soft hyphen causes parse error
      const result = await validator.validate(code, disablePreScan);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.code === 'PARSE_ERROR')).toBe(true);
    });
  });
});

describe('Helper Functions', () => {
  describe('normalizeHomoglyphs', () => {
    it('should replace Cyrillic homoglyphs with ASCII', () => {
      const input = '\u0430\u0435\u043E\u0440'; // аеор
      const result = normalizeHomoglyphs(input);
      expect(result).toBe('aeop');
    });

    it('should replace Greek homoglyphs with ASCII', () => {
      const input = '\u0391\u0392\u0395'; // ΑΒΕ
      const result = normalizeHomoglyphs(input);
      expect(result).toBe('ABE');
    });

    it('should replace fullwidth characters', () => {
      const input = '\uFF41\uFF42\uFF43'; // ａｂｃ
      const result = normalizeHomoglyphs(input);
      expect(result).toBe('abc');
    });

    it('should preserve non-homoglyph characters', () => {
      const input = 'hello世界';
      const result = normalizeHomoglyphs(input);
      expect(result).toBe('hello世界');
    });

    it('should handle mixed content', () => {
      const input = '\u0430dmin'; // аdmin with Cyrillic а
      const result = normalizeHomoglyphs(input);
      expect(result).toBe('admin');
    });
  });

  describe('isUnicodeSafe', () => {
    it('should return true for clean ASCII', () => {
      expect(isUnicodeSafe('hello world')).toBe(true);
      expect(isUnicodeSafe('admin123')).toBe(true);
      expect(isUnicodeSafe('test_variable')).toBe(true);
    });

    it('should return false for zero-width characters', () => {
      expect(isUnicodeSafe('hello\u200Bworld')).toBe(false);
      expect(isUnicodeSafe('\u200C')).toBe(false);
      expect(isUnicodeSafe('test\uFEFF')).toBe(false);
    });

    it('should return false for bidi characters', () => {
      expect(isUnicodeSafe('hello\u202Eworld')).toBe(false);
      expect(isUnicodeSafe('\u202A')).toBe(false);
    });

    it('should return false for homoglyphs', () => {
      expect(isUnicodeSafe('\u0430dmin')).toBe(false); // Cyrillic а
      expect(isUnicodeSafe('p\u0430ss')).toBe(false);
    });

    it('should return false for invisible characters', () => {
      expect(isUnicodeSafe('hello\u00ADworld')).toBe(false);
      expect(isUnicodeSafe('\u3164')).toBe(false);
    });

    it('should return true for legitimate unicode', () => {
      expect(isUnicodeSafe('Hello 世界')).toBe(true);
      expect(isUnicodeSafe('مرحبا')).toBe(true);
    });
  });
});
