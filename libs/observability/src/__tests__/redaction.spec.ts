import { redactFields } from '../logging/redaction';

describe('redactFields', () => {
  it('should return the same object when no fields to redact', () => {
    const obj = { name: 'test', value: 42 };
    const result = redactFields(obj, []);
    expect(result).toBe(obj);
  });

  it('should redact specified fields (case-insensitive)', () => {
    const obj = { username: 'alice', Password: 'secret123', token: 'abc' };
    const result = redactFields(obj, ['password', 'token']);
    expect(result).toEqual({
      username: 'alice',
      Password: '[REDACTED]',
      token: '[REDACTED]',
    });
  });

  it('should not mutate the original object', () => {
    const obj = { password: 'secret' };
    redactFields(obj, ['password']);
    expect(obj.password).toBe('secret');
  });

  it('should redact nested object fields', () => {
    const obj = {
      user: { name: 'alice', secret: 'key123' },
      data: 'safe',
    };
    const result = redactFields(obj, ['secret']);
    expect(result).toEqual({
      user: { name: 'alice', secret: '[REDACTED]' },
      data: 'safe',
    });
  });

  it('should redact fields in arrays of objects', () => {
    const obj = {
      items: [
        { id: 1, token: 'abc' },
        { id: 2, token: 'def' },
      ],
    };
    const result = redactFields(obj, ['token']);
    expect(result).toEqual({
      items: [
        { id: 1, token: '[REDACTED]' },
        { id: 2, token: '[REDACTED]' },
      ],
    });
  });

  it('should handle arrays with non-object items', () => {
    const obj = { tags: ['a', 'b', 'c'], password: 'secret' };
    const result = redactFields(obj, ['password']);
    expect(result).toEqual({
      tags: ['a', 'b', 'c'],
      password: '[REDACTED]',
    });
  });

  it('should respect maxDepth', () => {
    const obj = {
      level1: {
        level2: {
          secret: 'deep',
        },
      },
    };
    // With maxDepth=1, only top-level is processed
    const result = redactFields(obj, ['secret'], 1);
    expect(result).toEqual({
      level1: {
        level2: {
          secret: 'deep', // Not redacted — beyond maxDepth
        },
      },
    });
  });

  it('should handle Date values without treating them as objects', () => {
    const date = new Date('2026-01-01');
    const obj = { created: date, token: 'abc' };
    const result = redactFields(obj, ['token']);
    expect(result).toEqual({
      created: date,
      token: '[REDACTED]',
    });
  });

  it('should handle null values', () => {
    const obj = { name: null, token: 'abc' };
    const result = redactFields(obj, ['token']);
    expect(result).toEqual({
      name: null,
      token: '[REDACTED]',
    });
  });

  it('should handle empty objects', () => {
    const result = redactFields({}, ['password']);
    expect(result).toEqual({});
  });

  it('should preserve Map, Set, RegExp, and Error values unchanged', () => {
    const map = new Map([['a', 1]]);
    const set = new Set([1, 2]);
    const regex = /test/;
    const error = new Error('test');

    const obj = { map, set, regex, error, token: 'abc' };
    const result = redactFields(obj, ['token']);

    expect(result.map).toBe(map);
    expect(result.set).toBe(set);
    expect(result.regex).toBe(regex);
    expect(result.error).toBe(error);
    expect(result.token).toBe('[REDACTED]');
  });
});
