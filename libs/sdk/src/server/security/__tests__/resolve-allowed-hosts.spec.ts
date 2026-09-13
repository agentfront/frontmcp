/**
 * Default allow-list derivation for DNS-rebinding protection
 * (GHSA-mc9g-v2cp-vfff).
 *
 * Protection is on by default, so the derived list has to be right with zero
 * configuration: it must cover every spelling a local client legitimately uses,
 * and it must NOT be enforced in the one case where it cannot be complete (a
 * routable bind, where the public hostname is unknowable from inside the
 * process) — otherwise a proxied deployment goes dark on a patch upgrade.
 */
import {
  allowedHostsFromEnv,
  deriveAllowedHosts,
  isLoopbackAddress,
  isRoutableBind,
  shouldEnforceDerivedHosts,
} from '../resolve-allowed-hosts';

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.0.0.53', '::1', '[::1]', 'localhost', 'LOCALHOST'])('treats %s as loopback', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(true);
  });

  it.each(['0.0.0.0', '::', '10.0.0.4', '192.168.1.10', undefined])('treats %s as not loopback', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(false);
  });
});

describe('deriveAllowedHosts', () => {
  it('covers every loopback spelling, with and without the port', () => {
    const hosts = deriveAllowedHosts({ bindAddress: '127.0.0.1', port: 3000 });

    expect(hosts).toEqual(
      expect.arrayContaining(['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:3000', '[::1]', '[::1]:3000']),
    );
  });

  it('adds a specific NIC address the server is bound to', () => {
    expect(deriveAllowedHosts({ bindAddress: '10.0.0.4', port: 8080 })).toEqual(
      expect.arrayContaining(['10.0.0.4', '10.0.0.4:8080']),
    );
  });

  it('brackets a bare IPv6 bind address', () => {
    expect(deriveAllowedHosts({ bindAddress: 'fd00::1', port: 8080 })).toEqual(
      expect.arrayContaining(['[fd00::1]', '[fd00::1]:8080']),
    );
  });

  it('does not add a wildcard bind as a host', () => {
    const hosts = deriveAllowedHosts({ bindAddress: '0.0.0.0', port: 3000 });
    expect(hosts).not.toContain('0.0.0.0');
    expect(hosts).not.toContain('0.0.0.0:3000');
  });

  it('adds the issuer host so a configured public name keeps working', () => {
    expect(deriveAllowedHosts({ bindAddress: '0.0.0.0', port: 8080, issuer: 'https://api.example.com' })).toEqual(
      expect.arrayContaining(['api.example.com', 'api.example.com:8080']),
    );
  });

  it('ignores an unparseable issuer instead of throwing', () => {
    expect(() => deriveAllowedHosts({ issuer: 'not a url', port: 3000 })).not.toThrow();
  });

  it('returns nothing for a unix-socket server (no TCP host to check)', () => {
    expect(deriveAllowedHosts({ socketPath: '/tmp/frontmcp.sock' })).toEqual([]);
  });

  it('includes explicitly supplied extra hosts', () => {
    expect(deriveAllowedHosts({ bindAddress: '0.0.0.0', extraHosts: ['api.example.com'] })).toContain(
      'api.example.com',
    );
  });
});

describe('shouldEnforceDerivedHosts', () => {
  it('enforces for a loopback bind — that is the DNS-rebinding threat model', () => {
    expect(shouldEnforceDerivedHosts({ bindAddress: '127.0.0.1', port: 3000 })).toBe(true);
  });

  it('does NOT enforce a derived list for a routable bind with no public name', () => {
    // Enforcing here would 403 every request arriving under the deployment's
    // real hostname — a proxied server would go dark on a patch upgrade.
    expect(shouldEnforceDerivedHosts({ bindAddress: '0.0.0.0', port: 3000 })).toBe(false);
  });

  it('enforces for a routable bind once the issuer names the public host', () => {
    expect(shouldEnforceDerivedHosts({ bindAddress: '0.0.0.0', issuer: 'https://api.example.com' })).toBe(true);
  });

  it('enforces for a routable bind once hosts are supplied explicitly', () => {
    expect(shouldEnforceDerivedHosts({ bindAddress: '0.0.0.0', extraHosts: ['api.example.com'] })).toBe(true);
  });

  it('does not enforce for a unix-socket server', () => {
    expect(shouldEnforceDerivedHosts({ socketPath: '/tmp/frontmcp.sock' })).toBe(false);
  });

  it('does not enforce when the listening port is unknown', () => {
    // A `Host` header carries the port for every non-default port, so a
    // port-less derived list would reject every real request. A host that does
    // not tell the adapter what it listens on gets no derived enforcement.
    expect(shouldEnforceDerivedHosts({ bindAddress: '127.0.0.1' })).toBe(false);
    expect(shouldEnforceDerivedHosts({})).toBe(false);
  });

  it('still enforces without a port once a public name is supplied', () => {
    expect(shouldEnforceDerivedHosts({ issuer: 'https://api.example.com' })).toBe(true);
  });
});

describe('isRoutableBind', () => {
  it('is the inverse of loopback for a known address', () => {
    expect(isRoutableBind('0.0.0.0')).toBe(true);
    expect(isRoutableBind('127.0.0.1')).toBe(false);
  });

  it('treats an unknown address as not routable (nothing to enforce against)', () => {
    expect(isRoutableBind(undefined)).toBe(false);
  });
});

describe('allowedHostsFromEnv', () => {
  it('parses a comma-separated list', () => {
    expect(allowedHostsFromEnv({ FRONTMCP_ALLOWED_HOSTS: 'a.example, b.example:8080' })).toEqual([
      'a.example',
      'b.example:8080',
    ]);
  });

  it('returns undefined when unset or blank, so derivation still applies', () => {
    expect(allowedHostsFromEnv({})).toBeUndefined();
    expect(allowedHostsFromEnv({ FRONTMCP_ALLOWED_HOSTS: '   ' })).toBeUndefined();
    expect(allowedHostsFromEnv({ FRONTMCP_ALLOWED_HOSTS: ' , , ' })).toBeUndefined();
  });
});
