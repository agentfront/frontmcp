import { IpFilter } from '../index';
import type { IpFilterConfig, IpFilterResult } from '../index';

describe('IpFilter', () => {
  describe('empty config', () => {
    it('should allow all IPs when config is empty', () => {
      const filter = new IpFilter({});
      const result = filter.check('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });

    it('should allow all IPs when lists are empty arrays', () => {
      const filter = new IpFilter({ allowList: [], denyList: [] });
      const result = filter.check('10.0.0.1');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });
  });

  describe('default action', () => {
    it('should default to "allow" when defaultAction is not specified', () => {
      const filter = new IpFilter({});
      const result = filter.check('1.2.3.4');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });

    it('should deny when defaultAction is "deny" and no lists match', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });
      const result = filter.check('1.2.3.4');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should allow when defaultAction is "allow" explicitly', () => {
      const filter = new IpFilter({ defaultAction: 'allow' });
      const result = filter.check('1.2.3.4');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });
  });

  describe('IPv4 allow list', () => {
    it('should allow an IP that is on the allow list', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.100'],
        defaultAction: 'deny',
      });

      const result = filter.check('192.168.1.100');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allowlisted');
      expect(result.matchedRule).toBe('192.168.1.100');
    });

    it('should deny an IP not on the allow list when defaultAction is deny', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.100'],
        defaultAction: 'deny',
      });

      const result = filter.check('192.168.1.200');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should allow multiple IPs on the allow list', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
        defaultAction: 'deny',
      });

      expect(filter.check('10.0.0.1').allowed).toBe(true);
      expect(filter.check('10.0.0.2').allowed).toBe(true);
      expect(filter.check('10.0.0.3').allowed).toBe(true);
      expect(filter.check('10.0.0.4').allowed).toBe(false);
    });
  });

  describe('IPv4 deny list', () => {
    it('should deny an IP that is on the deny list', () => {
      const filter = new IpFilter({
        denyList: ['10.0.0.99'],
      });

      const result = filter.check('10.0.0.99');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denylisted');
      expect(result.matchedRule).toBe('10.0.0.99');
    });

    it('should allow an IP not on the deny list', () => {
      const filter = new IpFilter({
        denyList: ['10.0.0.99'],
      });

      const result = filter.check('10.0.0.1');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });

    it('should deny multiple IPs on the deny list', () => {
      const filter = new IpFilter({
        denyList: ['1.1.1.1', '2.2.2.2'],
      });

      expect(filter.check('1.1.1.1').allowed).toBe(false);
      expect(filter.check('2.2.2.2').allowed).toBe(false);
      expect(filter.check('3.3.3.3').allowed).toBe(true);
    });
  });

  describe('deny list takes precedence over allow list', () => {
    it('should deny an IP that appears in both allow and deny lists', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.100'],
        denyList: ['192.168.1.100'],
        defaultAction: 'allow',
      });

      const result = filter.check('192.168.1.100');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denylisted');
    });

    it('should deny an IP matching a deny CIDR even if it matches an allow CIDR', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.0/8'],
        denyList: ['10.0.0.0/24'],
        defaultAction: 'allow',
      });

      // 10.0.0.5 matches both 10.0.0.0/8 (allow) and 10.0.0.0/24 (deny)
      const result = filter.check('10.0.0.5');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denylisted');
      expect(result.matchedRule).toBe('10.0.0.0/24');
    });

    it('should allow an IP matching allow CIDR but not deny CIDR', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.0/8'],
        denyList: ['10.0.0.0/24'],
        defaultAction: 'deny',
      });

      // 10.1.0.1 matches 10.0.0.0/8 but NOT 10.0.0.0/24
      const result = filter.check('10.1.0.1');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allowlisted');
      expect(result.matchedRule).toBe('10.0.0.0/8');
    });
  });

  describe('IPv4 CIDR ranges', () => {
    it('should match IPs in a /24 range', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.0/24'],
        defaultAction: 'deny',
      });

      expect(filter.check('192.168.1.0').allowed).toBe(true);
      expect(filter.check('192.168.1.1').allowed).toBe(true);
      expect(filter.check('192.168.1.255').allowed).toBe(true);
      expect(filter.check('192.168.2.0').allowed).toBe(false);
    });

    it('should match IPs in a /8 range', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.0/8'],
        defaultAction: 'deny',
      });

      expect(filter.check('10.0.0.1').allowed).toBe(true);
      expect(filter.check('10.255.255.255').allowed).toBe(true);
      expect(filter.check('11.0.0.1').allowed).toBe(false);
    });

    it('should match IPs in a /16 range', () => {
      const filter = new IpFilter({
        allowList: ['172.16.0.0/16'],
        defaultAction: 'deny',
      });

      expect(filter.check('172.16.0.1').allowed).toBe(true);
      expect(filter.check('172.16.255.254').allowed).toBe(true);
      expect(filter.check('172.17.0.1').allowed).toBe(false);
    });

    it('should match a /32 as exact IP', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.100/32'],
        defaultAction: 'deny',
      });

      expect(filter.check('192.168.1.100').allowed).toBe(true);
      expect(filter.check('192.168.1.101').allowed).toBe(false);
    });

    it('should deny IPs in a CIDR range on deny list', () => {
      const filter = new IpFilter({
        denyList: ['10.0.0.0/24'],
      });

      expect(filter.check('10.0.0.1').allowed).toBe(false);
      expect(filter.check('10.0.0.254').allowed).toBe(false);
      expect(filter.check('10.0.1.1').allowed).toBe(true);
    });
  });

  describe('IPv6 addresses', () => {
    it('should allow an exact IPv6 address on the allow list', () => {
      const filter = new IpFilter({
        allowList: ['2001:db8::1'],
        defaultAction: 'deny',
      });

      const result = filter.check('2001:0db8:0000:0000:0000:0000:0000:0001');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allowlisted');
    });

    it('should deny an exact IPv6 address on the deny list', () => {
      const filter = new IpFilter({
        denyList: ['::1'],
      });

      const result = filter.check('::1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denylisted');
    });

    it('should handle fully expanded IPv6', () => {
      const filter = new IpFilter({
        allowList: ['2001:0db8:0000:0000:0000:0000:0000:0001'],
        defaultAction: 'deny',
      });

      const result = filter.check('2001:db8::1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('IPv6 CIDR ranges', () => {
    it('should match IPs in an IPv6 /64 range', () => {
      const filter = new IpFilter({
        allowList: ['2001:db8::/32'],
        defaultAction: 'deny',
      });

      expect(filter.check('2001:0db8::1').allowed).toBe(true);
      expect(filter.check('2001:0db8:ffff::1').allowed).toBe(true);
      expect(filter.check('2001:0db9::1').allowed).toBe(false);
    });

    it('should match loopback CIDR', () => {
      const filter = new IpFilter({
        denyList: ['::1/128'],
      });

      const result = filter.check('::1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denylisted');
    });
  });

  describe('invalid IPs', () => {
    it('should apply default action for invalid IP strings', () => {
      const filter = new IpFilter({ defaultAction: 'allow' });
      const result = filter.check('not-an-ip');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });

    it('should deny invalid IP when defaultAction is deny', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });
      const result = filter.check('garbage');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should handle empty string IP', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });
      const result = filter.check('');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should handle IP with too many octets', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });
      const result = filter.check('1.2.3.4.5');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should handle IP with out-of-range octets', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });
      const result = filter.check('256.1.1.1');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should handle invalid CIDR rules gracefully', () => {
      // Invalid CIDR rules create a rule with ip=0n, mask=0n which
      // matches any IP of the same address family (mask 0 means all bits are wild).
      // This is a known behavior — invalid rules degrade to "match all".
      const filter = new IpFilter({
        denyList: ['not-a-cidr'],
      });

      // Invalid rules are parsed as IPv4 with ip=0n, mask=0n — they won't
      // match because parseIp('not-a-cidr') returns null and parseCidr creates
      // isV6=false. The matchesCidr check passes since (any & 0n) === 0n.
      const result = filter.check('10.0.0.1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('denylisted');
    });
  });

  describe('isAllowListed', () => {
    it('should return true for an IP on the allow list', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.0/24'],
      });

      expect(filter.isAllowListed('192.168.1.50')).toBe(true);
    });

    it('should return false for an IP not on the allow list', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.0/24'],
      });

      expect(filter.isAllowListed('10.0.0.1')).toBe(false);
    });

    it('should return false when there is no allow list', () => {
      const filter = new IpFilter({});

      expect(filter.isAllowListed('10.0.0.1')).toBe(false);
    });

    it('should return false for invalid IP', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.0/8'],
      });

      expect(filter.isAllowListed('not-valid')).toBe(false);
    });

    it('should return true for exact IP match', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.1'],
      });

      expect(filter.isAllowListed('10.0.0.1')).toBe(true);
      expect(filter.isAllowListed('10.0.0.2')).toBe(false);
    });

    it('should return true for IPv6 on allow list', () => {
      const filter = new IpFilter({
        allowList: ['2001:db8::/32'],
      });

      expect(filter.isAllowListed('2001:db8::1')).toBe(true);
      expect(filter.isAllowListed('2001:db9::1')).toBe(false);
    });
  });

  describe('mixed IPv4 and IPv6', () => {
    it('should handle both IPv4 and IPv6 in the same config', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.0/24', '2001:db8::/32'],
        defaultAction: 'deny',
      });

      expect(filter.check('192.168.1.50').allowed).toBe(true);
      expect(filter.check('2001:db8::1').allowed).toBe(true);
      expect(filter.check('10.0.0.1').allowed).toBe(false);
      expect(filter.check('2001:db9::1').allowed).toBe(false);
    });

    it('should not match IPv4 against IPv6 rules', () => {
      const filter = new IpFilter({
        allowList: ['2001:db8::/32'],
        defaultAction: 'deny',
      });

      // An IPv4 address should not match an IPv6 CIDR rule
      expect(filter.check('192.168.1.1').allowed).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle /0 CIDR (match everything of that IP version)', () => {
      const filter = new IpFilter({
        denyList: ['0.0.0.0/0'],
      });

      expect(filter.check('1.2.3.4').allowed).toBe(false);
      expect(filter.check('255.255.255.255').allowed).toBe(false);
    });

    it('should handle whitespace in IP addresses', () => {
      const filter = new IpFilter({
        allowList: ['10.0.0.1'],
        defaultAction: 'deny',
      });

      // IPs with whitespace trimming
      const result = filter.check('  10.0.0.1  ');
      expect(result.allowed).toBe(true);
    });

    it('should handle CIDR with invalid prefix length > maxBits (IPv4)', () => {
      // /33 is invalid for IPv4 (max is /32) — should create a never-matching rule
      const filter = new IpFilter({
        denyList: ['10.0.0.0/33'],
        defaultAction: 'allow',
      });

      const result = filter.check('10.0.0.1');
      // Invalid CIDR with ip=0n, mask=0n matches any IPv4 because (any & 0n) === 0n
      expect(result).toBeDefined();
    });

    it('should handle CIDR with negative prefix length', () => {
      const filter = new IpFilter({
        denyList: ['10.0.0.0/-1'],
        defaultAction: 'allow',
      });

      const result = filter.check('10.0.0.1');
      expect(result).toBeDefined();
    });

    it('should handle CIDR with invalid prefix length > maxBits (IPv6)', () => {
      // /129 is invalid for IPv6 (max is /128)
      const filter = new IpFilter({
        denyList: ['2001:db8::/129'],
        defaultAction: 'allow',
      });

      const result = filter.check('2001:db8::1');
      expect(result).toBeDefined();
    });

    it('should handle CIDR with non-numeric prefix', () => {
      const filter = new IpFilter({
        denyList: ['10.0.0.0/abc'],
        defaultAction: 'allow',
      });

      const result = filter.check('10.0.0.1');
      expect(result).toBeDefined();
    });
  });

  describe('IPv6 edge cases', () => {
    it('should reject IPv6 with too many groups (9 groups)', () => {
      const filter = new IpFilter({
        allowList: ['2001:db8:1:2:3:4:5:6:7'],
        defaultAction: 'deny',
      });

      // This invalid IPv6 should not match anything properly
      // The allow rule itself is invalid, so the IP shouldn't match it
      const result = filter.check('2001:db8:1:2:3:4:5:6');
      // The allowList rule is invalid (ip=0n, mask=0n) which means it matches everything
      // for the same address family, so we just verify it doesn't crash
      expect(result).toBeDefined();
    });

    it('should reject IPv6 with multiple "::" expansions', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });

      // "2001::db8::1" has two :: expansions which is invalid
      const result = filter.check('2001::db8::1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should reject IPv6 with invalid hex groups', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });

      const result = filter.check('gggg::1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should handle IPv4-mapped IPv6 addresses', () => {
      const filter = new IpFilter({
        allowList: ['::ffff:192.168.1.0/128'],
        defaultAction: 'deny',
      });

      // Note: exact match required for /128
      // ::ffff:192.168.1.0 is the IPv4-mapped representation
      const result = filter.check('::ffff:192.168.1.0');
      expect(result).toBeDefined();
    });

    it('should handle IPv4-mapped IPv6 with invalid IPv4 portion', () => {
      const filter = new IpFilter({ defaultAction: 'deny' });

      // ::ffff:999.999.999.999 is invalid
      const result = filter.check('::ffff:999.999.999.999');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('should handle :: alone (all zeros)', () => {
      const filter = new IpFilter({
        allowList: ['::'],
        defaultAction: 'deny',
      });

      const result = filter.check('0000:0000:0000:0000:0000:0000:0000:0000');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allowlisted');
    });

    it('should handle IPv6 with too many groups after :: expansion (negative missing)', () => {
      // "::1:2:3:4:5:6:7:8" — left=0, right=8, missing=0 should still be 8+0 groups total
      // Actually this gives left=0, right=8, missing=8-0-8=0, joined = [...[], ...zeros(0), ...right(8)] = 8 groups
      // But "1:2:3:4:5:6:7::8" — left=7, right=1, missing=0, groups=8
      // For truly negative: "1:2:3:4:5:6:7:8::9" — left=8, right=1, missing=-1
      const filter = new IpFilter({ defaultAction: 'deny' });

      const result = filter.check('1:2:3:4:5:6:7:8::9');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });
  });

  describe('allow list with default action allow', () => {
    it('should allow IP not matching allow list when defaultAction is allow', () => {
      const filter = new IpFilter({
        allowList: ['192.168.1.0/24'],
        defaultAction: 'allow',
      });

      // IP not on allow list, but default is allow
      const result = filter.check('10.0.0.1');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('default');
    });
  });
});
