import { buildSetCookie, getCookie, isLocalhost, isSecureRequest, parseCookies } from '../cookie';

describe('isLocalhost', () => {
  it('should detect localhost', () => {
    expect(isLocalhost('localhost')).toBe(true);
    expect(isLocalhost('localhost:3000')).toBe(true);
  });

  it('should detect IPv4 loopback', () => {
    expect(isLocalhost('127.0.0.1')).toBe(true);
    expect(isLocalhost('127.0.0.1:8080')).toBe(true);
  });

  it('should detect IPv6 loopback', () => {
    expect(isLocalhost('::1')).toBe(true);
  });

  it('should detect 0.0.0.0', () => {
    expect(isLocalhost('0.0.0.0')).toBe(true);
    expect(isLocalhost('0.0.0.0:3000')).toBe(true);
  });

  it('should return false for external hosts', () => {
    expect(isLocalhost('example.com')).toBe(false);
    expect(isLocalhost('api.example.com:443')).toBe(false);
  });

  it('should return false for undefined/empty', () => {
    expect(isLocalhost(undefined)).toBe(false);
    expect(isLocalhost('')).toBe(false);
  });
});

describe('isSecureRequest', () => {
  it('should detect HTTPS via protocol field', () => {
    expect(isSecureRequest({ protocol: 'https' })).toBe(true);
    expect(isSecureRequest({ protocol: 'http' })).toBe(false);
  });

  it('should detect HTTPS via X-Forwarded-Proto header', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'https' } })).toBe(true);
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': 'http' } })).toBe(false);
  });

  it('should detect HTTPS via X-Forwarded-Proto array', () => {
    expect(isSecureRequest({ headers: { 'x-forwarded-proto': ['https', 'http'] } })).toBe(true);
  });

  it('should detect HTTPS via socket.encrypted', () => {
    expect(isSecureRequest({ socket: { encrypted: true } })).toBe(true);
    expect(isSecureRequest({ socket: { encrypted: false } })).toBe(false);
  });

  it('should return false for undefined/missing', () => {
    expect(isSecureRequest(undefined)).toBe(false);
    expect(isSecureRequest({})).toBe(false);
  });
});

describe('buildSetCookie', () => {
  it('should build a basic cookie', () => {
    const cookie = buildSetCookie({ name: 'test', value: 'abc' });
    expect(cookie).toContain('test=abc');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=86400');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('should omit Secure for localhost requests', () => {
    const cookie = buildSetCookie({ name: 'node', value: 'pod-a' }, { headers: { host: 'localhost:3000' } });
    expect(cookie).not.toContain('Secure');
  });

  it('should omit Secure for 127.0.0.1 requests', () => {
    const cookie = buildSetCookie({ name: 'node', value: 'pod-a' }, { headers: { host: '127.0.0.1:8080' } });
    expect(cookie).not.toContain('Secure');
  });

  it('should set Secure for HTTPS requests', () => {
    const cookie = buildSetCookie(
      { name: 'node', value: 'pod-a' },
      { protocol: 'https', headers: { host: 'api.example.com' } },
    );
    expect(cookie).toContain('Secure');
  });

  it('should set Secure when X-Forwarded-Proto is https', () => {
    const cookie = buildSetCookie(
      { name: 'node', value: 'pod-a' },
      { headers: { host: 'api.example.com', 'x-forwarded-proto': 'https' } },
    );
    expect(cookie).toContain('Secure');
  });

  it('should respect explicit secure=true', () => {
    const cookie = buildSetCookie(
      { name: 'node', value: 'pod-a', secure: true },
      { headers: { host: 'localhost:3000' } },
    );
    expect(cookie).toContain('Secure');
  });

  it('should respect explicit secure=false', () => {
    const cookie = buildSetCookie(
      { name: 'node', value: 'pod-a', secure: false },
      { protocol: 'https', headers: { host: 'api.example.com' } },
    );
    expect(cookie).not.toContain('Secure');
  });

  it('should encode special characters', () => {
    const cookie = buildSetCookie({ name: 'my cookie', value: 'val=ue;semi' });
    expect(cookie).toContain('my%20cookie=val%3Due%3Bsemi');
  });

  it('should use custom path and maxAge', () => {
    const cookie = buildSetCookie({ name: 'x', value: 'y', path: '/api', maxAge: 3600 });
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain('Max-Age=3600');
  });

  it('should omit HttpOnly when set to false', () => {
    const cookie = buildSetCookie({ name: 'x', value: 'y', httpOnly: false });
    expect(cookie).not.toContain('HttpOnly');
  });

  it('should include domain when specified', () => {
    const cookie = buildSetCookie({ name: 'x', value: 'y', domain: '.example.com' });
    expect(cookie).toContain('Domain=.example.com');
  });

  it('should support SameSite=None', () => {
    const cookie = buildSetCookie({ name: 'x', value: 'y', sameSite: 'None', secure: true });
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
  });

  it('should default to Secure in production when no request context', () => {
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const cookie = buildSetCookie({ name: 'x', value: 'y' });
      expect(cookie).toContain('Secure');
    } finally {
      process.env['NODE_ENV'] = origEnv;
    }
  });

  it('should omit Secure in development when no request context', () => {
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';
    try {
      const cookie = buildSetCookie({ name: 'x', value: 'y' });
      expect(cookie).not.toContain('Secure');
    } finally {
      process.env['NODE_ENV'] = origEnv;
    }
  });
});

describe('parseCookies', () => {
  it('should parse single cookie', () => {
    expect(parseCookies('name=value')).toEqual({ name: 'value' });
  });

  it('should parse multiple cookies', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('should decode URI components', () => {
    expect(parseCookies('my%20cookie=val%3Due')).toEqual({ 'my cookie': 'val=ue' });
  });

  it('should handle empty string', () => {
    expect(parseCookies('')).toEqual({});
  });

  it('should skip malformed pairs', () => {
    expect(parseCookies('valid=yes; noequals; other=ok')).toEqual({ valid: 'yes', other: 'ok' });
  });

  it('should handle values with equals signs', () => {
    expect(parseCookies('token=abc=def=ghi')).toEqual({ token: 'abc=def=ghi' });
  });
});

describe('getCookie', () => {
  it('should extract a specific cookie', () => {
    expect(getCookie('a=1; target=found; b=2', 'target')).toBe('found');
  });

  it('should return undefined for missing cookie', () => {
    expect(getCookie('a=1; b=2', 'missing')).toBeUndefined();
  });

  it('should return undefined for undefined header', () => {
    expect(getCookie(undefined, 'name')).toBeUndefined();
  });
});
