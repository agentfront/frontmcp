import { checkOutboundUrl, isPrivateIPv4, isPrivateIPv6 } from '../executor/ssrf-guard';
import type { OutboundOptions } from '../skilled-openapi.types';

const baseOutbound = (overrides: Partial<OutboundOptions> = {}): OutboundOptions => ({
  allowPrivateNetworks: false,
  maxConcurrencyPerHost: 10,
  defaultTimeoutMs: 30_000,
  defaultMaxResponseBytes: 256 * 1024,
  allowHttp: false,
  ...overrides,
});

describe('isPrivateIPv4', () => {
  it.each([
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.0', false],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateIPv4(ip)).toBe(expected);
  });
});

describe('isPrivateIPv6', () => {
  it.each([
    ['::1', true],
    ['::', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.1', true],
    ['::ffff:8.8.8.8', false],
    ['2001:db8::1', false],
  ])('%s -> %s', (ip, expected) => {
    expect(isPrivateIPv6(ip)).toBe(expected);
  });
});

describe('checkOutboundUrl', () => {
  it('rejects non-https schemes by default', async () => {
    const r = await checkOutboundUrl('http://example.com/x', new Set(['example.com']), baseOutbound());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/forbidden scheme/);
  });

  it('allows http when allowHttp=true', async () => {
    const r = await checkOutboundUrl(
      'http://localhost/x',
      new Set(['localhost']),
      baseOutbound({ allowHttp: true, allowPrivateNetworks: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects ftp/file/data schemes', async () => {
    for (const url of ['file:///etc/passwd', 'data:text/plain,xyz', 'ftp://example.com/x']) {
      const r = await checkOutboundUrl(url, new Set(['example.com']), baseOutbound());
      expect(r.ok).toBe(false);
    }
  });

  it('rejects URLs whose hostname is not in the allowlist', async () => {
    const r = await checkOutboundUrl('https://evil.com/x', new Set(['example.com']), baseOutbound());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not in the bundle's declared services/);
  });

  it('rejects cloud metadata hostnames even if technically allowlisted', async () => {
    const r = await checkOutboundUrl(
      'https://metadata.google.internal/computeMetadata/v1/',
      new Set(['metadata.google.internal']),
      baseOutbound(),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cloud metadata/);
  });

  it('rejects malformed URLs', async () => {
    const r = await checkOutboundUrl('not a url', new Set(), baseOutbound());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid URL/);
  });

  it('skips IP check when allowPrivateNetworks=true', async () => {
    // 'localhost' will resolve to 127.0.0.1 / ::1 — normally blocked, but allowed here.
    const r = await checkOutboundUrl(
      'https://localhost/x',
      new Set(['localhost']),
      baseOutbound({ allowPrivateNetworks: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects when DNS lookup fails entirely', async () => {
    const r = await checkOutboundUrl(
      'https://this-does-not-exist.invalid./x',
      new Set(['this-does-not-exist.invalid.']),
      baseOutbound(),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/DNS resolution failed/);
  });

  it('isPrivateIPv4 rejects malformed octets', () => {
    expect(isPrivateIPv4('999.0.0.1')).toBe(false);
    expect(isPrivateIPv4('not.an.ip.addr')).toBe(false);
    expect(isPrivateIPv4('10.0.0')).toBe(false);
  });

  it('rejects when host resolves to a private IP and allowPrivateNetworks=false', async () => {
    const r = await checkOutboundUrl(
      'https://localhost/x',
      new Set(['localhost']),
      baseOutbound({ allowPrivateNetworks: false }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private/);
  });
});
