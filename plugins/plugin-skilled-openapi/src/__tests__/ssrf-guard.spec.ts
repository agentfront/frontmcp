import * as dns from 'node:dns';

import {
  checkOutboundUrl,
  isAlwaysForbiddenIPv4,
  isAlwaysForbiddenIPv6,
  isPrivateIPv4,
  isPrivateIPv6,
} from '../executor/ssrf-guard';
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

  // ── SECURITY-REVIEW B2/B4: always-on metadata + IP-literal denylist ──────────

  it('blocks the IMDS IP literal even when allowPrivateNetworks=true (B2)', async () => {
    const r = await checkOutboundUrl(
      'https://169.254.169.254/latest/meta-data/',
      new Set(['169.254.169.254']),
      baseOutbound({ allowPrivateNetworks: true }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/metadata\/link-local/);
  });

  it('blocks the AWS IMDSv6 literal even when allowPrivateNetworks=true (B4)', async () => {
    const r = await checkOutboundUrl(
      'https://[fd00:ec2::254]/latest/meta-data/',
      new Set(['[fd00:ec2::254]']),
      baseOutbound({ allowPrivateNetworks: true }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/metadata\/link-local IPv6/);
  });

  it('blocks an IPv6 link-local literal even when allowPrivateNetworks=true', async () => {
    const r = await checkOutboundUrl(
      'https://[fe80::1]/x',
      new Set(['[fe80::1]']),
      baseOutbound({ allowPrivateNetworks: true }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/metadata\/link-local IPv6/);
  });

  it('blocks a CGNAT (100.64/10) IP literal when allowPrivateNetworks=false (B4)', async () => {
    const r = await checkOutboundUrl('https://100.64.0.1/x', new Set(['100.64.0.1']), baseOutbound());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private/);
  });

  it('allows a CGNAT IP literal when allowPrivateNetworks=true (it is private, not metadata)', async () => {
    const r = await checkOutboundUrl(
      'https://100.64.0.1/x',
      new Set(['100.64.0.1']),
      baseOutbound({ allowPrivateNetworks: true }),
    );
    expect(r.ok).toBe(true);
  });

  it('blocks an RFC1918 IP literal when allowPrivateNetworks=false (no DNS needed)', async () => {
    const r = await checkOutboundUrl('https://10.0.0.5/x', new Set(['10.0.0.5']), baseOutbound());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private\/loopback IPv4/);
  });

  it('allows a public IP literal', async () => {
    const r = await checkOutboundUrl('https://8.8.8.8/x', new Set(['8.8.8.8']), baseOutbound());
    expect(r.ok).toBe(true);
  });
});

describe('always-forbidden IP helpers (B2/B4)', () => {
  it.each([
    ['169.254.169.254', true],
    ['169.254.0.1', true],
    ['0.0.0.0', true],
    ['10.0.0.1', false],
    ['8.8.8.8', false],
  ])('isAlwaysForbiddenIPv4(%s) -> %s', (ip, expected) => {
    expect(isAlwaysForbiddenIPv4(ip)).toBe(expected);
  });

  it.each([
    ['fe80::1', true],
    ['fd00:ec2::254', true],
    ['::', true],
    ['::ffff:169.254.169.254', true],
    ['fd12:3456::1', false], // ULA but not metadata — gated by allowPrivateNetworks instead
    ['2001:db8::1', false],
  ])('isAlwaysForbiddenIPv6(%s) -> %s', (ip, expected) => {
    expect(isAlwaysForbiddenIPv6(ip)).toBe(expected);
  });

  it('CGNAT 100.64/10 is private', () => {
    expect(isPrivateIPv4('100.64.0.1')).toBe(true);
    expect(isPrivateIPv4('100.127.255.255')).toBe(true);
    expect(isPrivateIPv4('100.128.0.0')).toBe(false);
    expect(isPrivateIPv4('100.63.255.255')).toBe(false);
  });
});

describe('checkOutboundUrl — every IPv6 spelling of an internal address (GHSA-4r57-gvgj-5crm)', () => {
  // The runtime derives the allowlist from the bundle's baseUrl exactly like this, so a bundle that
  // declares an IPv6-literal service host allowlists the WHATWG-canonical (hex) form of that host.
  const checkBaseUrl = (baseUrl: string, outbound: OutboundOptions) =>
    checkOutboundUrl(`${baseUrl}/latest/meta-data/`, new Set([new URL(baseUrl).hostname.toLowerCase()]), outbound);

  const METADATA_FORMS = [
    ['https://[::ffff:169.254.169.254]', 'IPv4-mapped, dotted (canonicalised to ::ffff:a9fe:a9fe)'],
    ['https://[0:0:0:0:0:ffff:a9fe:a9fe]', 'IPv4-mapped, fully expanded'],
    ['https://[::ffff:0:a9fe:a9fe]', 'IPv4-translated (::ffff:0:0:0/96)'],
    ['https://[::a9fe:a9fe]', 'IPv4-compatible (::/96)'],
    ['https://[64:ff9b::a9fe:a9fe]', 'NAT64 well-known prefix (64:ff9b::/96)'],
    ['https://[64:ff9b:1::a9fe:a9fe]', 'NAT64 local-use prefix (64:ff9b:1::/48)'],
    ['https://[2002:a9fe:a9fe::]', '6to4 (2002::/16)'],
    ['https://[::ffff:0:0]', 'IPv4-mapped unspecified 0.0.0.0'],
  ] as const;

  const PRIVATE_FORMS = [
    ['https://[::ffff:10.0.0.5]', 'IPv4-mapped RFC 1918 10.0.0.5'],
    ['https://[::ffff:127.0.0.1]', 'IPv4-mapped loopback 127.0.0.1'],
  ] as const;

  it.each(METADATA_FORMS)('blocks %s (%s) with the default config', async (baseUrl) => {
    const result = await checkBaseUrl(baseUrl, baseOutbound());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/metadata\/link-local/);
  });

  it.each(METADATA_FORMS)('blocks %s (%s) even when allowPrivateNetworks=true', async (baseUrl) => {
    const result = await checkBaseUrl(baseUrl, baseOutbound({ allowPrivateNetworks: true }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/metadata\/link-local/);
  });

  it.each(PRIVATE_FORMS)('blocks %s (%s) with the default config', async (baseUrl) => {
    const result = await checkBaseUrl(baseUrl, baseOutbound());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/private/);
  });

  it.each(PRIVATE_FORMS)('allows %s (%s) when allowPrivateNetworks=true', async (baseUrl) => {
    expect((await checkBaseUrl(baseUrl, baseOutbound({ allowPrivateNetworks: true }))).ok).toBe(true);
  });

  it('blocks a DNS answer that is an IPv4-translated metadata address', async () => {
    const lookup = jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '::ffff:0:a9fe:a9fe', family: 6 }] as never);
    try {
      const result = await checkBaseUrl(
        'https://rebind.attacker.example',
        baseOutbound({ allowPrivateNetworks: true }),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/resolved to metadata\/link-local/);
    } finally {
      lookup.mockRestore();
    }
  });

  it('refuses a DNS answer it cannot parse rather than letting it through', async () => {
    const lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: 'fe80::g', family: 6 }] as never);
    try {
      const result = await checkBaseUrl('https://odd.attacker.example', baseOutbound({ allowPrivateNetworks: true }));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/malformed IP address/);
    } finally {
      lookup.mockRestore();
    }
  });

  it('allows a name it cannot resolve only when allowPrivateNetworks=true (IP literals stay checked)', async () => {
    const lookup = jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    try {
      expect(
        (await checkBaseUrl('https://api.internal.example', baseOutbound({ allowPrivateNetworks: true }))).ok,
      ).toBe(true);
      expect((await checkBaseUrl('https://api.internal.example', baseOutbound())).ok).toBe(false);
    } finally {
      lookup.mockRestore();
    }
  });

  it('still allows a public host name', async () => {
    const lookup = jest
      .spyOn(dns.promises, 'lookup')
      .mockResolvedValue([{ address: '54.187.174.169', family: 4 }] as never);
    try {
      expect((await checkBaseUrl('https://api.stripe.com', baseOutbound())).ok).toBe(true);
    } finally {
      lookup.mockRestore();
    }
  });

  it('still allows a public IPv6 literal', async () => {
    expect((await checkBaseUrl('https://[2606:4700::1111]', baseOutbound())).ok).toBe(true);
  });
});
