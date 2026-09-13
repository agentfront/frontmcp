/**
 * Host / Origin validation rules (GHSA-mc9g-v2cp-vfff).
 *
 * Normalization matters as much as the allow-list here: `Host` omits the port on
 * 80/443, hostnames are case-insensitive, and IPv6 literals are bracketed. An
 * exact string match over raw headers rejects legitimate clients (which is why
 * the old `strict: true` fallback of `['localhost', '127.0.0.1']` 403'd every
 * request on a non-80 port) while adding nothing against an attacker, who
 * controls the spelling anyway.
 */
import { compileHostValidation, normalizeHost, normalizeOrigin, validateHostHeaders } from '../host-validation';

describe('normalizeHost', () => {
  it('lowercases the hostname', () => {
    expect(normalizeHost('LocalHost:3000')).toBe('localhost:3000');
  });

  it('elides a default port so host and host:80 compare equal', () => {
    expect(normalizeHost('example.com:80')).toBe('example.com');
    expect(normalizeHost('example.com:443')).toBe('example.com');
  });

  it('keeps a non-default port', () => {
    expect(normalizeHost('example.com:3000')).toBe('example.com:3000');
  });

  it('keeps IPv6 brackets and splits the port correctly', () => {
    expect(normalizeHost('[::1]:3000')).toBe('[::1]:3000');
    expect(normalizeHost('[::1]')).toBe('[::1]');
    expect(normalizeHost('[::1]:443')).toBe('[::1]');
  });

  it('leaves a colon that is not a port separator alone', () => {
    expect(normalizeHost('example.com:notaport')).toBe('example.com:notaport');
  });
});

describe('normalizeOrigin', () => {
  it('normalizes scheme and host together', () => {
    expect(normalizeOrigin('HTTPS://App.Example.com:443')).toBe('https://app.example.com');
  });

  it('passes through a value with no scheme', () => {
    expect(normalizeOrigin('null')).toBe('null');
  });
});

describe('validateHostHeaders', () => {
  const compiled = compileHostValidation({ allowedHosts: ['localhost:3000', '127.0.0.1:3000', '[::1]:3000'] });

  it('allows a host on the list', () => {
    expect(validateHostHeaders({ host: 'localhost:3000' }, compiled)).toBeUndefined();
  });

  it('allows a differently-cased spelling of the same host', () => {
    expect(validateHostHeaders({ host: 'LOCALHOST:3000' }, compiled)).toBeUndefined();
  });

  it('rejects an attacker-controlled host', () => {
    expect(validateHostHeaders({ host: 'evil.attacker.example' }, compiled)).toEqual({
      status: 403,
      error: 'Forbidden',
      message: 'Invalid Host header',
    });
  });

  it('rejects a missing host', () => {
    expect(validateHostHeaders({}, compiled)?.status).toBe(403);
  });

  it('rejects a spoofed X-Forwarded-Host even when Host is valid', () => {
    const result = validateHostHeaders({ host: 'localhost:3000', forwardedHost: 'evil.example' }, compiled);
    expect(result?.message).toBe('Invalid X-Forwarded-Host header');
  });

  it('rejects when ANY hop of a forwarded chain is not allowed', () => {
    const result = validateHostHeaders(
      { host: 'localhost:3000', forwardedHost: 'localhost:3000, evil.example' },
      compiled,
    );
    expect(result?.message).toBe('Invalid X-Forwarded-Host header');
  });

  it('allows a forwarded chain whose hops are all allowed', () => {
    const result = validateHostHeaders(
      { host: 'localhost:3000', forwardedHost: 'localhost:3000 , 127.0.0.1:3000' },
      compiled,
    );
    expect(result).toBeUndefined();
  });

  it('skips host checking entirely when no hosts are configured', () => {
    const originsOnly = compileHostValidation({ allowedOrigins: ['https://app.example.com'] });
    expect(validateHostHeaders({ host: 'anything.example' }, originsOnly)).toBeUndefined();
  });

  describe('origin', () => {
    const withOrigins = compileHostValidation({ allowedOrigins: ['https://app.example.com'] });

    it('allows an origin on the list', () => {
      expect(validateHostHeaders({ origin: 'https://app.example.com' }, withOrigins)).toBeUndefined();
    });

    it('rejects a foreign origin', () => {
      expect(validateHostHeaders({ origin: 'https://evil.example' }, withOrigins)?.message).toBe(
        'Invalid Origin header',
      );
    });

    it('allows a request with no Origin at all (non-browser clients)', () => {
      // A rebound page always sends one; a CLI agent never does. Rejecting the
      // absent case would break every non-browser client for no gain.
      expect(validateHostHeaders({}, withOrigins)).toBeUndefined();
    });
  });
});
