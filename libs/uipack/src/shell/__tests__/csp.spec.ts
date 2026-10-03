import { buildCSPDirectives, DEFAULT_CDN_DOMAINS, sanitizeCSPDomains, validateCSPDomain } from '../csp';

function directive(directives: string[], name: string): string[] {
  const found = directives.find((d) => d.startsWith(`${name} `));
  return found ? found.split(' ').slice(1) : [];
}

describe('validateCSPDomain', () => {
  it.each([
    'https://api.example.com',
    'https://api.example.com:8443',
    'wss://realtime.example.com',
    'https://*.example.com',
    'wss://*.example.com',
    'https://*.api.example.co.uk',
    'https://cdn.example.com/assets/',
    'http://localhost:3000',
    'ws://localhost:3000',
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
  ])('accepts %s', (domain) => {
    expect(validateCSPDomain(domain)).toBe(true);
  });

  it.each([
    'http://api.example.com',
    'ws://realtime.example.com',
    'ftp://files.example.com',
    'javascript:alert(1)',
    'api.example.com',
    'https://*.com',
    'https://*.',
    'https://api.example.com/;script-src *',
    "https://api.example.com 'unsafe-eval'",
    'https://a.example.com,https://b.example.com',
    'wss://api.example.com?token=x',
    'https://api.example.com/v1?',
    'https://api.example.com#section',
    '',
  ])('rejects %s', (domain) => {
    expect(validateCSPDomain(domain)).toBe(false);
  });

  it('rejects a value that is not a string', () => {
    expect(validateCSPDomain(42 as unknown as string)).toBe(false);
  });
});

describe('sanitizeCSPDomains', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('keeps the valid domains and warns about each invalid one once', () => {
    const domains = ['wss://ws.example.com', 'ftp://once.example.com'];

    expect(sanitizeCSPDomains(domains)).toEqual(['wss://ws.example.com']);
    expect(sanitizeCSPDomains(domains)).toEqual(['wss://ws.example.com']);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('ftp://once.example.com');
  });

  it('returns no domains for none', () => {
    expect(sanitizeCSPDomains(undefined)).toEqual([]);
  });
});

describe('buildCSPDirectives', () => {
  it('lets the page connect to a declared wss:// origin', () => {
    const directives = buildCSPDirectives({ connectDomains: ['wss://realtime.example.com'] });

    expect(directive(directives, 'connect-src')).toContain('wss://realtime.example.com');
  });

  it('adds declared connect origins to the CDNs and resource origins instead of replacing them', () => {
    const directives = buildCSPDirectives({
      resourceDomains: ['https://assets.example.com'],
      connectDomains: ['https://api.example.com'],
    });
    const connect = directive(directives, 'connect-src');

    for (const cdn of DEFAULT_CDN_DOMAINS) expect(connect).toContain(cdn);
    expect(connect).toContain('https://assets.example.com');
    expect(connect).toContain('https://api.example.com');
  });

  it('lists each connect origin once', () => {
    const directives = buildCSPDirectives({ connectDomains: ['https://esm.sh', 'https://api.example.com'] });
    const connect = directive(directives, 'connect-src');

    expect(connect.filter((origin) => origin === 'https://esm.sh')).toHaveLength(1);
  });
});
