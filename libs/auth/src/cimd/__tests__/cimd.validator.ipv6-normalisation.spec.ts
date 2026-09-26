/**
 * Every IPv4-mapped IPv6 form is normalised before the private-range check
 * (GHSA-xx4w-33pp-cmw4).
 *
 * `checkIpv6` recognised exactly one spelling of an IPv4-mapped address:
 * `/^::ffff:(\d+\.\d+\.\d+\.\d+)$/`. IPv6 has several equivalent ways to write the same
 * address, and the hex form is the obvious one — `::ffff:7f00:1` IS `127.0.0.1`. It matched
 * no branch, fell past loopback, link-local and unique-local, and returned `allowed: true`.
 *
 * That turns the SSRF guard into a formality: a CIMD client id pointing at
 * `https://[::ffff:a9fe:a9fe]/...` reaches the cloud metadata service. The expanded
 * loopback `0:0:0:0:0:0:0:1` slipped through the same way, because the loopback branch
 * compared against the literal string `::1`.
 */
import { checkSsrfProtection, resolveAndCheckHostname } from '../cimd.validator';

/** Addresses that must all be refused; each is an alternate spelling of a blocked one. */
const BLOCKED = [
  ['::ffff:7f00:1', 'hex-form loopback (127.0.0.1)'],
  ['::ffff:7f00:0001', 'zero-padded hex loopback'],
  ['::FFFF:7F00:1', 'uppercase hex loopback'],
  ['::ffff:a00:1', 'hex-form private 10.0.0.1'],
  ['::ffff:c0a8:1', 'hex-form private 192.168.0.1'],
  ['::ffff:a9fe:a9fe', 'hex-form link-local 169.254.169.254 (cloud metadata)'],
  ['0:0:0:0:0:ffff:127.0.0.1', 'fully expanded mapped loopback'],
  ['0:0:0:0:0:0:0:1', 'fully expanded loopback'],
  ['::ffff:127.0.0.1', 'dotted-quad mapped loopback (already covered)'],
  ['::1', 'loopback'],
  ['fe80::1', 'link-local'],
  ['fd00::1', 'unique local'],
  ['::0.0.0.2', 'IPv4-compatible in the blocked 0.0.0.0/8 range'],
  ['::2', 'the same address in hex'],
  ['::ffff:0.0.0.2', 'IPv4-mapped 0.0.0.2'],
  ['64:ff9b::7f00:1', 'NAT64-embedded loopback'],
] as const;

/** Addresses that must keep working — the guard must not start refusing public hosts. */
const ALLOWED = [
  ['::ffff:8.8.8.8', 'mapped public address'],
  ['::ffff:808:808', 'hex-form public 8.8.8.8'],
  ['2400:cb00:2048:1::1', 'public IPv6'],
] as const;

describe('checkSsrfProtection — IPv6 normalisation (GHSA-xx4w-33pp-cmw4)', () => {
  it.each(BLOCKED)('refuses %s (%s)', (ip) => {
    expect(checkSsrfProtection(ip).allowed).toBe(false);
  });

  it.each(ALLOWED)('still allows %s (%s)', (ip) => {
    expect(checkSsrfProtection(ip).allowed).toBe(true);
  });

  it('refuses a bracketed hex-form loopback', () => {
    // `new URL('https://[::ffff:127.0.0.1]/x').hostname` canonicalises to the bracketed hex
    // form, so this is the shape the validator actually receives.
    expect(checkSsrfProtection('[::ffff:7f00:1]').allowed).toBe(false);
  });

  describe('the per-fetch hostname check', () => {
    // resolveAndCheckHostname returns early for any literal IP. That early return is only
    // safe because checkSsrfProtection runs first — so the second layer has to be shown to
    // refuse these too, not just the first.
    it.each(['::ffff:7f00:1', '[::ffff:7f00:1]', '::ffff:a9fe:a9fe', '0:0:0:0:0:0:0:1'])(
      'refuses the literal %s without reaching DNS',
      async (ip) => {
        await expect(resolveAndCheckHostname(ip)).resolves.toEqual(expect.objectContaining({ allowed: false }));
      },
    );

    it('still allows a public literal', async () => {
      await expect(resolveAndCheckHostname('::ffff:808:808')).resolves.toEqual(
        expect.objectContaining({ allowed: true }),
      );
    });
  });
});

describe('checkSsrfProtection — embedded IPv4 forms and special ranges (GHSA-xx4w-33pp-cmw4)', () => {
  const BLOCKED_EMBEDDINGS = [
    ['[::ffff:6440:1]', 'IPv4-mapped CGNAT 100.64.0.1'],
    ['[::ffff:ac10:1]', 'IPv4-mapped private 172.16.0.1'],
    ['[::ffff:0:a9fe:a9fe]', 'IPv4-translated metadata (::ffff:0:0:0/96)'],
    ['[::ffff:0:7f00:1]', 'IPv4-translated loopback'],
    ['[::a9fe:a9fe]', 'IPv4-compatible metadata (::/96)'],
    ['[64:ff9b::a9fe:a9fe]', 'NAT64 well-known prefix metadata (64:ff9b::/96)'],
    ['[64:ff9b:1::a9fe:a9fe]', 'NAT64 local-use prefix metadata (64:ff9b:1::/48)'],
    ['[2002:a9fe:a9fe::]', '6to4 metadata (2002::/16)'],
    ['[2002:7f00:1::1]', '6to4 loopback'],
    ['[::ffff:0:0]', 'IPv4-mapped 0.0.0.0'],
  ] as const;

  const BLOCKED_RANGES = [
    ['[fec0::1]', 'IPv6 site-local (fec0::/10)'],
    ['[ff02::1]', 'IPv6 multicast (ff00::/8)'],
    ['[fd00:ec2::254]', 'AWS IMDS IPv6'],
    ['198.18.0.1', 'benchmarking (198.18.0.0/15)'],
    ['240.0.0.1', 'reserved (240.0.0.0/4)'],
    ['192.0.0.192', 'IETF protocol assignments (192.0.0.0/24)'],
    ['255.255.255.255', 'broadcast'],
  ] as const;

  const STILL_ALLOWED = [
    ['[2002:808:808::1]', '6to4 carrying public 8.8.8.8'],
    ['[64:ff9b::808:808]', 'NAT64 carrying public 8.8.8.8'],
    ['[2606:4700::1111]', 'public IPv6'],
    ['198.20.0.1', 'just past 198.18.0.0/15'],
  ] as const;

  it.each(BLOCKED_EMBEDDINGS)('refuses %s (%s)', (host) => {
    expect(checkSsrfProtection(host).allowed).toBe(false);
  });

  it.each(BLOCKED_RANGES)('refuses %s (%s)', (host) => {
    expect(checkSsrfProtection(host).allowed).toBe(false);
  });

  it.each(STILL_ALLOWED)('still allows %s (%s)', (host) => {
    expect(checkSsrfProtection(host).allowed).toBe(true);
  });

  it('explains an embedded address with the IPv4 rule that caught it', () => {
    expect(checkSsrfProtection('[::ffff:0:a9fe:a9fe]').reason).toBe(
      'Link-local addresses (169.254.x.x) are not allowed',
    );
  });
});
