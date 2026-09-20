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
