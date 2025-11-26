import { sanitizeToJson, toStructuredContent, buildResourceContent, inferMimeType } from '../content.utils';

describe('Content Utils', () => {
  describe('sanitizeToJson', () => {
    it('should pass through primitives', () => {
      expect(sanitizeToJson('hello')).toBe('hello');
      expect(sanitizeToJson(42)).toBe(42);
      expect(sanitizeToJson(true)).toBe(true);
      expect(sanitizeToJson(null)).toBe(null);
    });

    it('should convert BigInt to string', () => {
      expect(sanitizeToJson(BigInt(9007199254740991))).toBe('9007199254740991');
    });

    it('should convert Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      expect(sanitizeToJson(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should convert Error to object with name, message, stack', () => {
      const error = new Error('Test error');
      const result = sanitizeToJson(error) as Record<string, unknown>;

      expect(result.name).toBe('Error');
      expect(result.message).toBe('Test error');
      expect(typeof result.stack).toBe('string');
    });

    it('should convert Map to object', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      expect(sanitizeToJson(map)).toEqual({ a: 1, b: 2 });
    });

    it('should convert Set to array', () => {
      const set = new Set([1, 2, 3]);
      expect(sanitizeToJson(set)).toEqual([1, 2, 3]);
    });

    it('should drop functions', () => {
      expect(sanitizeToJson(() => 42)).toBeUndefined();
      expect(
        sanitizeToJson(function test() {
          return 42;
        }),
      ).toBeUndefined();
    });

    it('should drop symbols', () => {
      expect(sanitizeToJson(Symbol('test'))).toBeUndefined();
    });

    it('should handle circular references', () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      const result = sanitizeToJson(obj) as Record<string, unknown>;
      expect(result.a).toBe(1);
      expect(result.self).toBeUndefined();
    });

    it('should recursively sanitize nested objects', () => {
      const obj = {
        date: new Date('2024-01-15T10:30:00.000Z'),
        nested: {
          bigint: BigInt(123),
          set: new Set([1, 2]),
        },
      };

      const result = sanitizeToJson(obj);
      expect(result).toEqual({
        date: '2024-01-15T10:30:00.000Z',
        nested: {
          bigint: '123',
          set: [1, 2],
        },
      });
    });

    it('should handle arrays', () => {
      const arr = [1, new Date('2024-01-01T00:00:00.000Z'), { a: 1 }];
      const result = sanitizeToJson(arr);

      expect(result).toEqual([1, '2024-01-01T00:00:00.000Z', { a: 1 }]);
    });

    it('should drop undefined values in objects', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const result = sanitizeToJson(obj) as Record<string, unknown>;

      expect(result).toEqual({ a: 1, c: 3 });
      expect('b' in result).toBe(false);
    });

    it('should handle nested Map with non-string keys', () => {
      const map = new Map<any, any>([
        [1, 'one'],
        [{ key: 'obj' }, 'object'],
      ]);
      const result = sanitizeToJson(map);

      expect(result).toEqual({
        '1': 'one',
        '[object Object]': 'object',
      });
    });
  });

  describe('toStructuredContent', () => {
    it('should wrap primitives in { value: ... }', () => {
      expect(toStructuredContent('hello')).toEqual({ value: 'hello' });
      expect(toStructuredContent(42)).toEqual({ value: 42 });
      expect(toStructuredContent(true)).toEqual({ value: true });
    });

    it('should return object as-is', () => {
      const obj = { a: 1, b: 'test' };
      expect(toStructuredContent(obj)).toEqual({ a: 1, b: 'test' });
    });

    it('should wrap arrays in { value: ... }', () => {
      expect(toStructuredContent([1, 2, 3])).toEqual({ value: [1, 2, 3] });
    });

    it('should return undefined for null', () => {
      expect(toStructuredContent(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(toStructuredContent(undefined)).toBeUndefined();
    });

    it('should sanitize before structuring', () => {
      const obj = {
        date: new Date('2024-01-15T10:30:00.000Z'),
        func: () => 42,
      };
      const result = toStructuredContent(obj);

      expect(result).toEqual({ date: '2024-01-15T10:30:00.000Z' });
    });
  });

  describe('buildResourceContent', () => {
    it('should build text content from string', () => {
      const result = buildResourceContent('test://uri', 'Hello world');

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'text/plain',
        text: 'Hello world',
      });
    });

    it('should build blob content from Buffer', () => {
      const buffer = Buffer.from('Hello world');
      const result = buildResourceContent('test://uri', buffer);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'application/octet-stream',
        blob: buffer.toString('base64'),
      });
    });

    it('should build blob content from Uint8Array', () => {
      const array = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const result = buildResourceContent('test://uri', array);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'application/octet-stream',
        blob: Buffer.from(array).toString('base64'),
      });
    });

    it('should build JSON text from object', () => {
      const obj = { key: 'value', num: 42 };
      const result = buildResourceContent('test://uri', obj);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'application/json',
        text: JSON.stringify(obj),
      });
    });

    it('should preserve existing text content format', () => {
      const existing = { text: 'existing content', mimeType: 'text/html' };
      const result = buildResourceContent('test://uri', existing);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'text/html',
        text: 'existing content',
      });
    });

    it('should preserve existing blob content format', () => {
      const existing = { blob: 'base64data', mimeType: 'image/png' };
      const result = buildResourceContent('test://uri', existing);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'image/png',
        blob: 'base64data',
      });
    });

    it('should use provided mimeType over default', () => {
      const result = buildResourceContent('test://uri', 'content', 'text/markdown');

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'text/markdown',
        text: 'content',
      });
    });

    it('should handle null by converting to string', () => {
      const result = buildResourceContent('test://uri', null);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'application/json',
        text: 'null',
      });
    });

    it('should handle arrays', () => {
      const result = buildResourceContent('test://uri', [1, 2, 3]);

      expect(result).toEqual({
        uri: 'test://uri',
        mimeType: 'application/json',
        text: '[1,2,3]',
      });
    });
  });

  describe('inferMimeType', () => {
    it('should infer from .json extension', () => {
      expect(inferMimeType('file:///data.json')).toBe('application/json');
    });

    it('should infer from .md extension', () => {
      expect(inferMimeType('file:///readme.md')).toBe('text/markdown');
    });

    it('should infer from .png extension', () => {
      expect(inferMimeType('file:///image.png')).toBe('image/png');
    });

    it('should infer from .jpg extension', () => {
      expect(inferMimeType('file:///photo.jpg')).toBe('image/jpeg');
    });

    it('should infer from .html extension', () => {
      expect(inferMimeType('file:///page.html')).toBe('text/html');
    });

    it('should infer from .css extension', () => {
      expect(inferMimeType('file:///style.css')).toBe('text/css');
    });

    it('should infer from .js extension', () => {
      expect(inferMimeType('file:///script.js')).toBe('application/javascript');
    });

    it('should infer from .ts extension', () => {
      expect(inferMimeType('file:///code.ts')).toBe('application/typescript');
    });

    it('should infer from .yaml extension', () => {
      expect(inferMimeType('file:///config.yaml')).toBe('application/yaml');
    });

    it('should infer from .yml extension', () => {
      expect(inferMimeType('file:///config.yml')).toBe('application/yaml');
    });

    it('should infer from .xml extension', () => {
      expect(inferMimeType('file:///data.xml')).toBe('application/xml');
    });

    it('should infer from .pdf extension', () => {
      expect(inferMimeType('file:///document.pdf')).toBe('application/pdf');
    });

    it('should infer JSON from content starting with {', () => {
      expect(inferMimeType('unknown://uri', '{"key": "value"}')).toBe('application/json');
    });

    it('should infer JSON from content starting with [', () => {
      expect(inferMimeType('unknown://uri', '[1, 2, 3]')).toBe('application/json');
    });

    it('should infer HTML from content with <!DOCTYPE', () => {
      expect(inferMimeType('unknown://uri', '<!DOCTYPE html><html>')).toBe('text/html');
    });

    it('should infer HTML from content with <html', () => {
      expect(inferMimeType('unknown://uri', '<html><body>')).toBe('text/html');
    });

    it('should infer XML from content starting with <', () => {
      expect(inferMimeType('unknown://uri', '<root><item/></root>')).toBe('application/xml');
    });

    it('should default to text/plain', () => {
      expect(inferMimeType('unknown://uri')).toBe('text/plain');
      expect(inferMimeType('unknown://uri', 'plain text content')).toBe('text/plain');
    });

    it('should handle URIs without extension', () => {
      expect(inferMimeType('api://resource')).toBe('text/plain');
    });

    it('should handle case insensitive extensions', () => {
      expect(inferMimeType('file:///data.JSON')).toBe('application/json');
      expect(inferMimeType('file:///image.PNG')).toBe('image/png');
    });
  });
});
