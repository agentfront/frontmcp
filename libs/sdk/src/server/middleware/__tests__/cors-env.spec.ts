import { readCorsFromEnv, resolveHttpCors } from '../cors-env';

const KEYS = ['FRONTMCP_CORS_ORIGINS', 'FRONTMCP_CORS_CREDENTIALS', 'FRONTMCP_CORS_MAX_AGE'];

describe('CORS from frontmcp.config server.http.cors (FRONTMCP_CORS_*)', () => {
  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it('is off without FRONTMCP_CORS_ORIGINS', () => {
    expect(readCorsFromEnv()).toBeUndefined();
  });

  it('reads a JSON list of origins with credentials and max age', () => {
    process.env['FRONTMCP_CORS_ORIGINS'] = '["https://a.example.com","https://b.example.com"]';
    process.env['FRONTMCP_CORS_CREDENTIALS'] = 'true';
    process.env['FRONTMCP_CORS_MAX_AGE'] = '600';
    expect(readCorsFromEnv()).toEqual({
      origin: ['https://a.example.com', 'https://b.example.com'],
      credentials: true,
      maxAge: 600,
    });
  });

  it('accepts a comma-separated list and maps "*" to any origin', () => {
    process.env['FRONTMCP_CORS_ORIGINS'] = 'https://a.example.com, *';
    expect(readCorsFromEnv()).toEqual({ origin: true });
    process.env['FRONTMCP_CORS_ORIGINS'] = 'https://a.example.com,https://b.example.com';
    expect(readCorsFromEnv()?.origin).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('ignores an empty list and a non-positive max age', () => {
    process.env['FRONTMCP_CORS_ORIGINS'] = '[]';
    expect(readCorsFromEnv()).toBeUndefined();
    process.env['FRONTMCP_CORS_ORIGINS'] = '["https://a.example.com"]';
    process.env['FRONTMCP_CORS_MAX_AGE'] = '-1';
    process.env['FRONTMCP_CORS_CREDENTIALS'] = 'no';
    expect(readCorsFromEnv()).toEqual({ origin: ['https://a.example.com'], credentials: false });
  });

  it('lets an explicit @FrontMcp http.cors win, including false', () => {
    process.env['FRONTMCP_CORS_ORIGINS'] = '["https://a.example.com"]';
    expect(resolveHttpCors(false)).toBe(false);
    expect(resolveHttpCors({ origin: 'https://explicit.example.com' })).toEqual({
      origin: 'https://explicit.example.com',
    });
    expect(resolveHttpCors(undefined)).toEqual({ origin: ['https://a.example.com'] });
  });
});
