import { isAllowedOutboundAddress, validateOutboundUrl } from '../outbound-url';

describe('validateOutboundUrl', () => {
  it.each([
    'https://hooks.example.com/mcp/events',
    'https://hooks.example.com:8443/path?tenant=acme#fragment',
    'https://8.8.8.8/hook',
    'https://[2606:4700::1111]/hook',
    'https://xn--bcher-kva.example/hook',
    'HTTPS://Hooks.Example.COM/hook',
    'https://localhost.example.com/hook',
    'https://metadata.example.com/hook',
  ])('accepts %s and returns it parsed', (target) => {
    const check = validateOutboundUrl(target);

    expect(check).toEqual({ ok: true, url: new URL(target) });
  });

  it.each([
    '',
    'not a url',
    '/relative/path',
    'https://',
    'https://exa mple.com/',
    'https://[::1',
    'https://1.2.3.256/',
  ])('reports %p as malformed', (target) => {
    expect(validateOutboundUrl(target)).toEqual({ ok: false, problem: 'malformed' });
    expect(validateOutboundUrl(target, { allowLocal: true })).toEqual({ ok: false, problem: 'malformed' });
  });

  it.each([
    'http://hooks.example.com/hook',
    'ftp://hooks.example.com/hook',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,hello',
    'ws://hooks.example.com/hook',
    'gopher://hooks.example.com/',
  ])('refuses the scheme of %s', (target) => {
    expect(validateOutboundUrl(target)).toEqual({ ok: false, problem: 'scheme' });
  });

  it.each(['ftp://127.0.0.1/hook', 'file:///etc/passwd', 'ws://localhost/hook'])(
    'refuses the scheme of %s even with allowLocal',
    (target) => {
      expect(validateOutboundUrl(target, { allowLocal: true })).toEqual({ ok: false, problem: 'scheme' });
    },
  );

  it.each([
    'https://user:password@hooks.example.com/hook',
    'https://user@hooks.example.com/hook',
    'https://:password@hooks.example.com/hook',
    'https://hooks.example.com%40evil.example@127.0.0.1/hook',
  ])('refuses the credentials in %s', (target) => {
    expect(validateOutboundUrl(target)).toEqual({ ok: false, problem: 'credentials' });
    expect(validateOutboundUrl(target, { allowLocal: true })).toEqual({ ok: false, problem: 'credentials' });
  });

  it.each([
    ['https://127.0.0.1/hook', 'loopback'],
    ['https://127.1/hook', 'loopback, short form'],
    ['https://2130706433/hook', 'loopback, as one number'],
    ['https://0x7f.0.0.1/hook', 'loopback, hexadecimal'],
    ['https://0177.0.0.1/hook', 'loopback, octal'],
    ['https://127.0.0.1./hook', 'loopback, trailing dot'],
    ['https://[::1]/hook', 'IPv6 loopback'],
    ['https://[0:0:0:0:0:0:0:1]:8443/hook', 'IPv6 loopback, expanded'],
    ['https://10.0.0.5/hook', 'RFC 1918'],
    ['https://172.16.4.4/hook', 'RFC 1918'],
    ['https://192.168.1.10/hook', 'RFC 1918'],
    ['https://100.64.0.1/hook', 'carrier-grade NAT'],
    ['https://169.254.10.10/hook', 'link-local'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://[fd00:ec2::254]/latest/meta-data/', 'IPv6 cloud metadata'],
    ['https://[::ffff:169.254.169.254]/hook', 'IPv4-mapped metadata'],
    ['https://[::ffff:a9fe:a9fe]/hook', 'IPv4-mapped metadata, hexadecimal'],
    ['https://[::ffff:10.0.0.5]/hook', 'IPv4-mapped RFC 1918'],
    ['https://[::ffff:7f00:1]/hook', 'IPv4-mapped loopback'],
    ['https://[64:ff9b::7f00:1]/hook', 'NAT64 loopback'],
    ['https://[2002:7f00:1::]/hook', '6to4 loopback'],
    ['https://[fc00::1]/hook', 'unique local'],
    ['https://[fe80::1]/hook', 'IPv6 link-local'],
    ['https://[ff02::1]/hook', 'multicast'],
    ['https://224.0.0.1/hook', 'multicast'],
    ['https://0.0.0.0/hook', 'unspecified'],
    ['https://[::]/hook', 'IPv6 unspecified'],
    ['https://255.255.255.255/hook', 'broadcast'],
    ['https://203.0.113.10/hook', 'documentation'],
    ['https://[2001:db8::1]/hook', 'IPv6 documentation'],
    ['https://localhost/hook', 'localhost'],
    ['https://LOCALHOST:8443/hook', 'localhost, uppercase'],
    ['https://localhost./hook', 'localhost, trailing dot'],
    ['https://api.localhost/hook', 'a .localhost name'],
    ['https://localhost.localdomain/hook', 'localhost.localdomain'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'GCP metadata name'],
    ['https://metadata.goog/computeMetadata/v1/', 'GCP metadata name'],
    ['https://metadata/computeMetadata/v1/', 'bare metadata name'],
    ['https://metadata.azure.com/metadata/instance', 'Azure metadata name'],
    ['https://metadata.aws.com/latest/', 'AWS metadata name'],
  ])('refuses the host of %s (%s)', (target) => {
    expect(validateOutboundUrl(target)).toEqual({ ok: false, problem: 'host' });
  });

  describe('with allowLocal', () => {
    it.each([
      'http://127.0.0.1:3000/hook',
      'http://localhost:3000/hook',
      'http://api.localhost/hook',
      'http://[::1]:3000/hook',
      'https://127.0.0.1/hook',
      'http://10.0.0.5/hook',
      'http://192.168.1.10:8080/hook',
      'http://[fd12:3456::1]/hook',
      'http://[::ffff:127.0.0.1]/hook',
      'http://hooks.example.com/hook',
      'https://hooks.example.com/hook',
    ])('accepts %s', (target) => {
      expect(validateOutboundUrl(target, { allowLocal: true })).toEqual({ ok: true, url: new URL(target) });
    });

    it.each([
      ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
      ['http://[fd00:ec2::254]/latest/meta-data/', 'IPv6 cloud metadata'],
      ['http://[::ffff:169.254.169.254]/hook', 'IPv4-mapped metadata'],
      ['http://169.254.10.10/hook', 'link-local'],
      ['http://[fe80::1]/hook', 'IPv6 link-local'],
      ['http://0.0.0.0:3000/hook', 'unspecified'],
      ['http://100.64.0.1/hook', 'carrier-grade NAT'],
      ['http://224.0.0.1/hook', 'multicast'],
      ['http://203.0.113.10/hook', 'documentation'],
      ['http://metadata.google.internal/computeMetadata/v1/', 'GCP metadata name'],
      ['http://metadata/computeMetadata/v1/', 'bare metadata name'],
    ])('still refuses the host of %s (%s)', (target) => {
      expect(validateOutboundUrl(target, { allowLocal: true })).toEqual({ ok: false, problem: 'host' });
    });
  });
});

describe('isAllowedOutboundAddress', () => {
  it.each(['8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])('allows the public address %s', (address) => {
    expect(isAllowedOutboundAddress(address)).toBe(true);
    expect(isAllowedOutboundAddress(address, { allowLocal: true })).toBe(true);
  });

  it.each(['127.0.0.1', '::1', '10.0.0.5', '172.16.0.1', '192.168.1.1', 'fd12:3456::1', '::ffff:127.0.0.1'])(
    'allows the loopback or private address %s only with allowLocal',
    (address) => {
      expect(isAllowedOutboundAddress(address)).toBe(false);
      expect(isAllowedOutboundAddress(address, { allowLocal: false })).toBe(false);
      expect(isAllowedOutboundAddress(address, { allowLocal: true })).toBe(true);
    },
  );

  it.each(['169.254.169.254', 'fd00:ec2::254', 'fe80::1', '0.0.0.0', '::', '100.64.0.1', '224.0.0.1', '203.0.113.10'])(
    'never allows %s',
    (address) => {
      expect(isAllowedOutboundAddress(address)).toBe(false);
      expect(isAllowedOutboundAddress(address, { allowLocal: true })).toBe(false);
    },
  );

  it.each(['example.com', 'localhost', '', '999.1.1.1'])('never allows %p, which is not an IP address', (address) => {
    expect(isAllowedOutboundAddress(address)).toBe(false);
    expect(isAllowedOutboundAddress(address, { allowLocal: true })).toBe(false);
  });
});
