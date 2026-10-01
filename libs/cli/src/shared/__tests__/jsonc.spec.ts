import { JsoncParseError, parseJsoncObject, updateJsoncText } from '../jsonc';

describe('parseJsoncObject', () => {
  it('accepts comments and trailing commas', () => {
    expect(
      parseJsoncObject('{\n  // c\n  "a": 1, /* b */\n  "b": [1, 2,],\n}\n', 'tsconfig.json'),
    ).toEqual({ a: 1, b: [1, 2] });
  });

  it('accepts a UTF-8 byte order mark', () => {
    expect(parseJsoncObject('﻿{ "a": true }', 'tsconfig.json')).toEqual({ a: true });
  });

  it('reports the first error with its line and column', () => {
    try {
      parseJsoncObject('{\n  "a": 1,,\n}', 'tsconfig.json');
      throw new Error('expected a parse error');
    } catch (err) {
      expect(err).toBeInstanceOf(JsoncParseError);
      const parseError = err as JsoncParseError;
      expect(parseError.file).toBe('tsconfig.json');
      expect(parseError.line).toBe(2);
      expect(parseError.column).toBe(10);
      expect(parseError.message).toMatch(/^tsconfig\.json is not valid JSON: \w+ at line 2, column 10$/);
    }
  });

  it.each(['[]', '"text"', '42', 'null'])('rejects a non-object top level (%s)', (text) => {
    expect(() => parseJsoncObject(text, 'tsconfig.json')).toThrow(JsoncParseError);
  });
});

describe('updateJsoncText', () => {
  it('returns the text unchanged when nothing differs', () => {
    const text = '{\n  // keep me\n  "a": { "b": 1 },\n}\n';
    expect(updateJsoncText(text, { a: { b: 1 } }, { a: { b: 1 } })).toBe(text);
  });

  it('changes only differing leaves and keeps comments', () => {
    const text = '{\n  // header\n  "compilerOptions": {\n    "target": "es5", // old\n    "strict": true\n  }\n}\n';
    const before = parseJsoncObject(text, 'x.json');
    const updated = updateJsoncText(text, before, {
      compilerOptions: { target: 'es2021', strict: true, module: 'esnext' },
      exclude: ['a'],
    });
    expect(updated).toContain('// header');
    expect(updated).toContain('// old');
    expect(parseJsoncObject(updated, 'x.json')).toEqual({
      compilerOptions: { target: 'es2021', strict: true, module: 'esnext' },
      exclude: ['a'],
    });
  });

  it('keeps tab indentation, CRLF line endings and the BOM', () => {
    const text = '﻿{\r\n\t"a": 1\r\n}\r\n';
    const updated = updateJsoncText(text, { a: 1 }, { a: 1, b: 2 });
    expect(updated.startsWith('﻿')).toBe(true);
    expect(updated).toContain('\r\n\t"b": 2');
    expect(parseJsoncObject(updated, 'x.json')).toEqual({ a: 1, b: 2 });
  });
});
