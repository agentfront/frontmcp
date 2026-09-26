import { classifyIpAddress, expandIpv6, extractEmbeddedIpv4, parseIpv4 } from '../ip-address';

describe('parseIpv4', () => {
  it.each([
    ['0.0.0.0', [0, 0, 0, 0]],
    ['169.254.169.254', [169, 254, 169, 254]],
    ['255.255.255.255', [255, 255, 255, 255]],
  ])('parses %s', (address, octets) => {
    expect(parseIpv4(address)).toEqual(octets);
  });

  it.each(['256.0.0.1', '1.2.3', '1.2.3.4.5', '010.0.0.1', '0x7f.0.0.1', '1.2.3.', '', 'a.b.c.d', ' 1.2.3.4'])(
    'refuses %p',
    (address) => {
      expect(parseIpv4(address)).toBeUndefined();
    },
  );
});

describe('expandIpv6', () => {
  it.each([
    ['::', [0, 0, 0, 0, 0, 0, 0, 0]],
    ['::1', [0, 0, 0, 0, 0, 0, 0, 1]],
    ['fe80::1%eth0', [0xfe80, 0, 0, 0, 0, 0, 0, 1]],
    ['::ffff:127.0.0.1', [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]],
    ['0:0:0:0:0:FFFF:A9FE:A9FE', [0, 0, 0, 0, 0, 0xffff, 0xa9fe, 0xa9fe]],
    ['2002:a9fe:a9fe::', [0x2002, 0xa9fe, 0xa9fe, 0, 0, 0, 0, 0]],
    ['1:2:3:4:5:6:7:8', [1, 2, 3, 4, 5, 6, 7, 8]],
  ])('expands %s', (address, groups) => {
    expect(expandIpv6(address)).toEqual(groups);
  });

  it.each([
    '1::2::3',
    '1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4::5:6:7:8',
    '::ffff:a9fe:a9fe:',
    ':1::',
    '12345::',
    '::ffff:1.2.3.256',
    '::ffff:010.0.0.1',
    '::1.2.3.4:5',
    'not-an-address',
  ])('refuses %p', (address) => {
    expect(expandIpv6(address)).toBeUndefined();
  });
});

describe('expandIpv6 on adversarial input', () => {
  it('rejects a long run of dots after a colon in linear time', () => {
    const startedAt = Date.now();
    expect(expandIpv6(`:.${'.'.repeat(200_000)}`)).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(200);
  });
});

describe('extractEmbeddedIpv4', () => {
  it.each([
    ['::ffff:a9fe:a9fe', '169.254.169.254', 'IPv4-mapped'],
    ['::ffff:0:a9fe:a9fe', '169.254.169.254', 'IPv4-translated'],
    ['::a9fe:a9fe', '169.254.169.254', 'IPv4-compatible'],
    ['64:ff9b::a9fe:a9fe', '169.254.169.254', 'NAT64 well-known prefix'],
    ['2002:a9fe:a9fe::1', '169.254.169.254', '6to4'],
  ])('reads %s as %s (%s)', (address, embedded) => {
    const groups = expandIpv6(address);
    expect(groups && extractEmbeddedIpv4(groups)).toBe(embedded);
  });

  it.each([
    '2606:4700::1111',
    'fe80::1',
    '64:ff9b:2::a9fe:a9fe',
    '2001:db8::a9fe:a9fe',
    '64:ff9b:1::a9fe:a9fe',
    '64:ff9b:1:ffff::a9fe:a9fe',
  ])('finds nothing in %s', (address) => {
    const groups = expandIpv6(address);
    expect(groups && extractEmbeddedIpv4(groups)).toBeUndefined();
  });
});

describe('classifyIpAddress', () => {
  it.each([
    ['0.1.2.3', 'this-network', '0.0.0.0/8'],
    ['10.0.0.5', 'private', '10.0.0.0/8'],
    ['100.64.0.1', 'carrier-grade-nat', '100.64.0.0/10'],
    ['100.127.255.255', 'carrier-grade-nat', '100.64.0.0/10'],
    ['127.0.0.1', 'loopback', '127.0.0.0/8'],
    ['169.254.169.254', 'link-local', '169.254.0.0/16'],
    ['172.16.0.1', 'private', '172.16.0.0/12'],
    ['172.31.255.255', 'private', '172.16.0.0/12'],
    ['192.0.0.192', 'ietf-protocol', '192.0.0.0/24'],
    ['192.168.1.1', 'private', '192.168.0.0/16'],
    ['198.18.0.1', 'benchmarking', '198.18.0.0/15'],
    ['198.19.255.255', 'benchmarking', '198.18.0.0/15'],
    ['224.0.0.1', 'multicast', '224.0.0.0/4'],
    ['239.255.255.255', 'multicast', '224.0.0.0/4'],
    ['240.0.0.1', 'reserved', '240.0.0.0/4'],
    ['255.255.255.255', 'reserved', '255.255.255.255/32'],
  ])('classifies IPv4 %s as %s (%s)', (address, range, cidr) => {
    expect(classifyIpAddress(address)).toEqual({ family: 4, range, cidr });
  });

  it.each(['8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.0', '172.32.0.0', '198.20.0.1', '223.255.255.255'])(
    'classifies IPv4 %s as public',
    (address) => {
      expect(classifyIpAddress(address)).toEqual({ family: 4, range: 'public' });
    },
  );

  it.each([
    ['::', 'unspecified', '::/128'],
    ['[::1]', 'loopback', '::1/128'],
    ['0:0:0:0:0:0:0:1', 'loopback', '::1/128'],
    ['fd00:ec2::254', 'cloud-metadata', 'fd00:ec2::254/128'],
    ['fd12:3456::1', 'private', 'fc00::/7'],
    ['fc00::1', 'private', 'fc00::/7'],
    ['fe80::1%en0', 'link-local', 'fe80::/10'],
    ['febf::1', 'link-local', 'fe80::/10'],
    ['fec0::1', 'site-local', 'fec0::/10'],
    ['ff02::1', 'multicast', 'ff00::/8'],
    ['64:ff9b:1::a9fe:a9fe', 'local-use-nat64', '64:ff9b:1::/48'],
    ['64:ff9b:1:a9fe:a9:fe00:808:808', 'local-use-nat64', '64:ff9b:1::/48'],
  ])('classifies IPv6 %s as %s (%s)', (address, range, cidr) => {
    expect(classifyIpAddress(address)).toEqual({ family: 6, range, cidr });
  });

  it.each([
    ['[::ffff:a9fe:a9fe]', 'link-local', '169.254.169.254'],
    ['::ffff:10.0.0.5', 'private', '10.0.0.5'],
    ['::ffff:7f00:1', 'loopback', '127.0.0.1'],
    ['::ffff:6440:1', 'carrier-grade-nat', '100.64.0.1'],
    ['::ffff:0:0', 'this-network', '0.0.0.0'],
    ['::ffff:0:a9fe:a9fe', 'link-local', '169.254.169.254'],
    ['::a9fe:a9fe', 'link-local', '169.254.169.254'],
    ['::2', 'this-network', '0.0.0.2'],
    ['64:ff9b::7f00:1', 'loopback', '127.0.0.1'],
    ['2002:a9fe:a9fe::', 'link-local', '169.254.169.254'],
  ])('classifies IPv6 %s by its embedded IPv4 as %s', (address, range, embeddedIpv4) => {
    expect(classifyIpAddress(address)).toEqual(expect.objectContaining({ family: 6, range, embeddedIpv4 }));
  });

  it.each([
    ['::ffff:808:808', '8.8.8.8'],
    ['2002:808:808::1', '8.8.8.8'],
  ])('classifies IPv6 %s carrying public %s as public', (address, embeddedIpv4) => {
    expect(classifyIpAddress(address)).toEqual({ family: 6, range: 'public', embeddedIpv4 });
  });

  it.each(['2606:4700::1111', '2400:cb00:2048:1::1'])('classifies IPv6 %s as public', (address) => {
    expect(classifyIpAddress(address)).toEqual({ family: 6, range: 'public' });
  });

  it.each(['localhost', 'example.com', '999.0.0.1', '[127.0.0.1]', '[::1', '::g', ''])(
    'returns undefined for %p, which is not an IP literal',
    (address) => {
      expect(classifyIpAddress(address)).toBeUndefined();
    },
  );
});
