import { redactFields, redactJson } from './redaction';

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

  it('should redact the keys a predicate names', () => {
    const result = redactFields({ apiKey: 'k', name: 'n' }, (key) => key.endsWith('Key'));
    expect(result).toEqual({ apiKey: '[REDACTED]', name: 'n' });
  });

  it('should redact objects inside nested arrays', () => {
    const result = redactFields({ rows: [[{ token: 'abc' }]] }, ['token']);
    expect(result).toEqual({ rows: [[{ token: '[REDACTED]' }]] });
  });
});

describe('redactJson', () => {
  it('should redact at any depth, also at the top of a list', () => {
    const deep = { a: { b: { c: { d: { e: { f: { token: 'abc' } } } } } } };
    expect(redactJson([deep], ['token'])).toEqual([{ a: { b: { c: { d: { e: { f: { token: '[REDACTED]' } } } } } } }]);
  });

  it('should redact inside a string that holds a JSON object or list', () => {
    const answer = { content: [{ type: 'text', text: JSON.stringify({ user: 'ada', password: 'hunter2' }, null, 2) }] };
    const redacted = redactJson(answer, ['password']) as { content: Array<{ text: string }> };
    expect(JSON.parse(redacted.content[0].text)).toEqual({ user: 'ada', password: '[REDACTED]' });
  });

  it('should keep a JSON text that has nothing to redact as it was written', () => {
    const text = JSON.stringify({ user: 'ada' }, null, 2);
    expect(redactJson({ text }, ['password'])).toEqual({ text });
  });

  it('should keep text that only looks like JSON', () => {
    expect(redactJson({ text: '{not json' }, ['password'])).toEqual({ text: '{not json' });
  });

  it('should keep values other than objects, lists and strings', () => {
    expect(redactJson({ count: 3, ok: true, none: null }, ['token'])).toEqual({ count: 3, ok: true, none: null });
    expect(redactJson('plain', ['token'])).toBe('plain');
  });

  it('should redact a bearer or basic credential and a JWT under any key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJl';
    const input = { q: 'Bearer sk-live-4f9a8b7c', auth: 'basic dXNlcjpwYXNzd29yZA==', note: `token ${jwt} expired` };
    expect(redactJson(input, [])).toEqual({
      q: 'Bearer [REDACTED]',
      auth: 'basic [REDACTED]',
      note: 'token [REDACTED] expired',
    });
  });

  it('should redact the credentials of a URL and its query or fragment values under a redacted name', () => {
    const urls = [
      'https://ada:hunter2@db.example.com/x',
      'https://ghp_abc123@github.com/org/repo.git',
      'https://api.example.com/cb?code=1&access_token=tok-1#id_token=tok-2',
    ];
    expect(redactJson({ urls }, (key) => key.endsWith('token'))).toEqual({
      urls: [
        'https://[REDACTED]@db.example.com/x',
        'https://[REDACTED]@github.com/org/repo.git',
        'https://api.example.com/cb?code=1&access_token=[REDACTED]#id_token=[REDACTED]',
      ],
    });
  });

  it('should redact a value assigned to a redacted name in text that is not JSON', () => {
    const script = `await callTool('fetch', { apiKey: "sk-123", "password": 'hunter2', city: 'Paris' });\nTOKEN=abc def`;
    expect(redactJson(script, ['apikey', 'password', 'token'])).toBe(
      `await callTool('fetch', { apiKey: "[REDACTED]", "password": '[REDACTED]', city: 'Paris' });\nTOKEN=[REDACTED] def`,
    );
  });

  it('should redact a redacted name inside the value of another name', () => {
    const text = 'redirect=https://app.example.com/cb?token=abc&next=1 and query: "token=def"';
    expect(redactJson(text, ['token'])).toBe(
      'redirect=https://app.example.com/cb?token=[REDACTED]&next=1 and query: "token=[REDACTED]"',
    );
  });

  it('should keep prose that only mentions a scheme or a redacted name', () => {
    const text = 'Bearer authentication needs a token:\nask the admin';
    expect(redactJson(text, ['token'])).toBe(text);
  });
});
