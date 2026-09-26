/** A dual-stack socket reports IPv4 clients as `::ffff:a.b.c.d`; they must match IPv4 rules (GHSA-hwfp-xv2f-fr8g). */
import { IpFilter } from '../ip-filter';

describe('IpFilter IPv4-mapped peers (GHSA-hwfp-xv2f-fr8g)', () => {
  const mappedForms = [
    '::ffff:203.0.113.7',
    '::FFFF:203.0.113.7',
    '::ffff:cb00:7107',
    '0:0:0:0:0:ffff:203.0.113.7',
    '0000:0000:0000:0000:0000:ffff:cb00:7107',
  ];

  it.each(mappedForms)('denies %s against an IPv4 denyList rule', (peer) => {
    const filter = new IpFilter({ denyList: ['203.0.113.0/24'] });

    expect(filter.check(peer)).toEqual({ allowed: false, reason: 'denylisted', matchedRule: '203.0.113.0/24' });
  });

  it.each(mappedForms)('allows %s against an IPv4 allowList rule under defaultAction deny', (peer) => {
    const filter = new IpFilter({ allowList: ['203.0.113.7'], defaultAction: 'deny' });

    expect(filter.check(peer)).toEqual({ allowed: true, reason: 'allowlisted', matchedRule: '203.0.113.7' });
    expect(filter.isAllowListed(peer)).toBe(true);
  });

  it('matches a plain IPv4 peer against a rule written in mapped form', () => {
    const filter = new IpFilter({ denyList: ['::ffff:203.0.113.0/120'] });

    expect(filter.check('203.0.113.200').allowed).toBe(false);
    expect(filter.check('203.0.114.1').allowed).toBe(true);
  });

  it('matches a zoned link-local peer against its IPv6 rule', () => {
    const filter = new IpFilter({ denyList: ['fe80::/10'] });

    expect(filter.check('fe80::1%eth0').allowed).toBe(false);
  });

  it('keeps native IPv6 peers out of IPv4 rules', () => {
    const filter = new IpFilter({ denyList: ['0.0.0.0/0'] });

    expect(filter.check('2001:db8::1').allowed).toBe(true);
  });

  it('keeps IPv4 peers out of native IPv6 rules', () => {
    const filter = new IpFilter({ denyList: ['::/0'] });

    expect(filter.check('::ffff:203.0.113.7').allowed).toBe(true);
    expect(filter.check('2001:db8::1').allowed).toBe(false);
  });

  it.each(['1a.2.3.4', '::ffff:1.2.3', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', 'fe80::1%', '1:2:3:4::5:6:7:8'])(
    'treats the malformed address %s as unparseable',
    (peer) => {
      const filter = new IpFilter({ allowList: ['0.0.0.0/0', '::/0'], defaultAction: 'deny' });

      expect(filter.check(peer)).toEqual({ allowed: false, reason: 'default' });
    },
  );
});
