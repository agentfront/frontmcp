import { JsoncDuplicateKeyError, JsoncParseError, parseJsoncObject, updateJsoncText } from '../jsonc';

describe('parseJsoncObject', () => {
  it('accepts comments and trailing commas', () => {
    expect(parseJsoncObject('{\n  // c\n  "a": 1, /* b */\n  "b": [1, 2,],\n}\n', 'tsconfig.json')).toEqual({
      a: 1,
      b: [1, 2],
    });
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
    expect(updateJsoncText(text, { a: { b: 1 } }, { a: { b: 1 } }, 'x.json')).toBe(text);
  });

  it('changes only differing leaves and keeps comments', () => {
    const text = '{\n  // header\n  "compilerOptions": {\n    "target": "es5", // old\n    "strict": true\n  }\n}\n';
    const before = parseJsoncObject(text, 'x.json');
    const updated = updateJsoncText(
      text,
      before,
      { compilerOptions: { target: 'es2021', strict: true, module: 'esnext' }, exclude: ['a'] },
      'x.json',
    );
    expect(updated).toContain('// header');
    expect(updated).toContain('// old');
    expect(parseJsoncObject(updated, 'x.json')).toEqual({
      compilerOptions: { target: 'es2021', strict: true, module: 'esnext' },
      exclude: ['a'],
    });
  });

  it('keeps tab indentation, CRLF line endings and the BOM', () => {
    const text = '﻿{\r\n\t"a": 1\r\n}\r\n';
    const updated = updateJsoncText(text, { a: 1 }, { a: 1, b: 2 }, 'x.json');
    expect(updated.startsWith('﻿')).toBe(true);
    expect(updated).toContain('\r\n\t"b": 2');
    expect(parseJsoncObject(updated, 'x.json')).toEqual({ a: 1, b: 2 });
  });

  // The parser keeps the last duplicate while modify() edits the first.
  it('refuses to edit a key declared more than once', () => {
    const text =
      '{\n  "compilerOptions": {\n    "emitDecoratorMetadata": true,\n    "emitDecoratorMetadata": false\n  }\n}\n';
    const before = parseJsoncObject(text, 'tsconfig.json');
    expect(before).toEqual({ compilerOptions: { emitDecoratorMetadata: false } });

    try {
      updateJsoncText(text, before, { compilerOptions: { emitDecoratorMetadata: true } }, 'tsconfig.json');
      throw new Error('expected a duplicate-key error');
    } catch (err) {
      expect(err).toBeInstanceOf(JsoncDuplicateKeyError);
      const duplicate = err as JsoncDuplicateKeyError;
      expect(duplicate.file).toBe('tsconfig.json');
      expect(duplicate.key).toBe('compilerOptions.emitDecoratorMetadata');
      expect(duplicate.lines).toEqual([3, 4]);
      expect(duplicate.message).toBe(
        'tsconfig.json declares "compilerOptions.emitDecoratorMetadata" more than once (lines 3, 4) and only the last one takes effect',
      );
    }
  });

  it('refuses to edit inside an object declared more than once', () => {
    const text = '{ "compilerOptions": { "target": "es5" }, "compilerOptions": { "strict": true } }';
    const before = parseJsoncObject(text, 'tsconfig.json');

    expect(() =>
      updateJsoncText(text, before, { compilerOptions: { strict: true, target: 'es2021' } }, 'tsconfig.json'),
    ).toThrow(/declares "compilerOptions" more than once \(lines 1, 1\)/);
  });

  it('edits normally when the duplicated keys are not touched', () => {
    const text = '{ "compilerOptions": { "strict": true, "strict": false }, "include": ["src"] }';
    const before = parseJsoncObject(text, 'tsconfig.json');
    const after = { compilerOptions: { strict: false, target: 'es2021' }, include: ['src'] };

    expect(parseJsoncObject(updateJsoncText(text, before, after, 'tsconfig.json'), 'tsconfig.json')).toEqual(after);
  });
});
