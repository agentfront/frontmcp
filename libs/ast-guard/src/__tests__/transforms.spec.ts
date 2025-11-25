import * as acorn from 'acorn';
import { generate } from 'astring';
import { extractLargeStrings, shouldExtract, transformConcatenation, transformTemplateLiterals } from '../transforms';

describe('String Extraction Transform', () => {
  const parseCode = (code: string) =>
    acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });

  describe('extractLargeStrings', () => {
    it('should extract strings exceeding threshold', () => {
      const code = `const large = "${'x'.repeat(100)}";`;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(1);
      expect(result.extractedBytes).toBe(100);
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toBe('x'.repeat(100));

      const output = generate(ast);
      expect(output).toContain('__REF_1__');
      expect(output).not.toContain('x'.repeat(100));
    });

    it('should not extract strings below threshold', () => {
      const code = `const small = "hello";`;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(0);
      expect(extracted).toHaveLength(0);

      const output = generate(ast);
      expect(output).toContain('hello');
    });

    it('should extract multiple large strings', () => {
      const code = `
        const a = "${'a'.repeat(100)}";
        const b = "${'b'.repeat(100)}";
        const c = "small";
      `;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(2);
      expect(extracted).toHaveLength(2);

      const output = generate(ast);
      expect(output).toContain('__REF_1__');
      expect(output).toContain('__REF_2__');
      expect(output).toContain('small');
    });

    it('should extract static template literals', () => {
      const code = `const large = \`${'x'.repeat(100)}\`;`;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(1);
      expect(extracted[0]).toBe('x'.repeat(100));
    });

    it('should not extract template literals with expressions', () => {
      const largeStr = 'x'.repeat(100);
      const code = `const mixed = \`prefix\${variable}${largeStr}\`;`;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(0);
    });

    it('should return reference IDs in result', () => {
      const code = `const a = "${'a'.repeat(100)}"; const b = "${'b'.repeat(100)}";`;
      const ast = parseCode(code);
      let counter = 0;

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: () => `__REF_${++counter}__`,
      });

      expect(result.referenceIds).toEqual(['__REF_1__', '__REF_2__']);
    });

    it('should handle non-string literals', () => {
      const code = `const num = 12345; const bool = true; const nul = null;`;
      const ast = parseCode(code);

      const result = extractLargeStrings(ast, {
        threshold: 1,
        onExtract: () => '__REF__',
      });

      expect(result.extractedCount).toBe(0);
    });

    it('should handle strings in nested structures', () => {
      const code = `
        const obj = {
          key: "${'x'.repeat(100)}",
          nested: {
            deep: "${'y'.repeat(100)}"
          }
        };
      `;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(2);
    });

    it('should handle strings in function arguments', () => {
      const code = `callTool("toolName", { data: "${'x'.repeat(100)}" });`;
      const ast = parseCode(code);
      const extracted: string[] = [];

      const result = extractLargeStrings(ast, {
        threshold: 50,
        onExtract: (value) => {
          extracted.push(value);
          return `__REF_${extracted.length}__`;
        },
      });

      expect(result.extractedCount).toBe(1);
      expect(extracted[0]).toBe('x'.repeat(100));

      const output = generate(ast);
      expect(output).toContain('toolName'); // Not extracted (below threshold)
      expect(output).toContain('__REF_1__');
    });
  });

  describe('shouldExtract', () => {
    it('should return true for strings at or above threshold', () => {
      expect(shouldExtract('x'.repeat(100), 100)).toBe(true);
      expect(shouldExtract('x'.repeat(101), 100)).toBe(true);
    });

    it('should return false for strings below threshold', () => {
      expect(shouldExtract('x'.repeat(99), 100)).toBe(false);
      expect(shouldExtract('hello', 100)).toBe(false);
    });

    it('should handle multi-byte characters', () => {
      // Each emoji is 4 bytes in UTF-8
      const emoji = '\u{1F600}'; // Grinning face
      expect(Buffer.byteLength(emoji)).toBe(4);

      // 25 emojis = 100 bytes
      expect(shouldExtract(emoji.repeat(25), 100)).toBe(true);
      expect(shouldExtract(emoji.repeat(24), 100)).toBe(false);
    });
  });
});

describe('Concatenation Transform', () => {
  const parseCode = (code: string) =>
    acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });

  describe('transformConcatenation', () => {
    it('should transform simple concatenation', () => {
      const code = `const result = a + b;`;
      const ast = parseCode(code);

      const result = transformConcatenation(ast);

      expect(result.transformedCount).toBe(1);

      const output = generate(ast);
      expect(output).toContain('__safe_concat(a, b)');
    });

    it('should transform chained concatenation', () => {
      const code = `const result = a + b + c;`;
      const ast = parseCode(code);

      const result = transformConcatenation(ast);

      expect(result.transformedCount).toBe(2);

      const output = generate(ast);
      // a + b + c becomes __safe_concat(__safe_concat(a, b), c)
      expect(output).toContain('__safe_concat(__safe_concat(a, b), c)');
    });

    it('should not transform other operators', () => {
      const code = `const result = a - b * c / d;`;
      const ast = parseCode(code);

      const result = transformConcatenation(ast);

      expect(result.transformedCount).toBe(0);

      const output = generate(ast);
      expect(output).not.toContain('__safe_concat');
    });

    it('should use custom prefix', () => {
      const code = `const result = a + b;`;
      const ast = parseCode(code);

      transformConcatenation(ast, { prefix: '__custom_' });

      const output = generate(ast);
      expect(output).toContain('__custom_concat(a, b)');
    });

    it('should use custom function name', () => {
      const code = `const result = a + b;`;
      const ast = parseCode(code);

      transformConcatenation(ast, { functionName: 'add' });

      const output = generate(ast);
      expect(output).toContain('__safe_add(a, b)');
    });

    it('should transform string literal concatenation', () => {
      const code = `const result = "hello" + " " + "world";`;
      const ast = parseCode(code);

      const result = transformConcatenation(ast);

      expect(result.transformedCount).toBe(2);

      const output = generate(ast);
      expect(output).toContain('__safe_concat');
    });

    it('should transform concatenation in expressions', () => {
      const code = `callTool("tool", { data: prefix + suffix });`;
      const ast = parseCode(code);

      const result = transformConcatenation(ast);

      expect(result.transformedCount).toBe(1);

      const output = generate(ast);
      expect(output).toContain('__safe_concat(prefix, suffix)');
    });
  });

  describe('transformTemplateLiterals', () => {
    it('should transform template literals with expressions', () => {
      const code = 'const result = `Hello ${name}!`;';
      const ast = parseCode(code);

      const result = transformTemplateLiterals(ast);

      expect(result.transformedCount).toBe(1);

      const output = generate(ast);
      expect(output).toContain('__safe_template');
      expect(output).toContain('["Hello ", "!"]');
      expect(output).toContain('name');
    });

    it('should not transform static template literals', () => {
      const code = 'const result = `static string`;';
      const ast = parseCode(code);

      const result = transformTemplateLiterals(ast);

      expect(result.transformedCount).toBe(0);
    });

    it('should transform multiple expressions', () => {
      const code = 'const result = `${a} + ${b} = ${c}`;';
      const ast = parseCode(code);

      const result = transformTemplateLiterals(ast);

      expect(result.transformedCount).toBe(1);

      const output = generate(ast);
      expect(output).toContain('__safe_template');
    });

    it('should use custom prefix', () => {
      const code = 'const result = `Hello ${name}`;';
      const ast = parseCode(code);

      transformTemplateLiterals(ast, { prefix: '__custom_' });

      const output = generate(ast);
      expect(output).toContain('__custom_template');
    });
  });
});
