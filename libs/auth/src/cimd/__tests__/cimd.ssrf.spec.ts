import * as dns from 'node:dns';

import { CimdSecurityError } from '../cimd.errors';
import { assertHostNotSsrf, resolveAndCheckHostname } from '../cimd.validator';

/**
 * CIMD SSRF regression tests — DNS-aware hostname validation.
 *
 * The pre-fix `checkSsrfProtection` only inspected literal-IP and localhost
 * strings, so a `client_id` host that RESOLVES to an internal address (cloud
 * metadata 169.254.169.254, 10.x, 127.x, IPv6 ULA, CGNAT) bypassed the guard
 * and the server fetched it. `resolveAndCheckHostname` now resolves the name and
 * rejects if ANY resolved address is internal. `node:dns` is mocked so these
 * tests are hermetic.
 */
jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }));

const mockLookup = dns.promises.lookup as unknown as jest.Mock;

describe('CIMD SSRF — DNS-aware hostname validation', () => {
  beforeEach(() => mockLookup.mockReset());

  it('rejects a hostname that resolves to cloud-metadata 169.254.169.254', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const result = await resolveAndCheckHostname('metadata.attacker.example');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/169\.254\.169\.254/);
    await expect(
      assertHostNotSsrf('metadata.attacker.example', 'https://metadata.attacker.example/x'),
    ).rejects.toBeInstanceOf(CimdSecurityError);
  });

  it('rejects a hostname that resolves to a private 10.x address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect((await resolveAndCheckHostname('internal.attacker.example')).allowed).toBe(false);
  });

  it('rejects a hostname that resolves to loopback 127.0.0.1', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect((await resolveAndCheckHostname('rebind.attacker.example')).allowed).toBe(false);
  });

  it('rejects when ANY of several resolved addresses is internal', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    expect((await resolveAndCheckHostname('mixed.attacker.example')).allowed).toBe(false);
  });

  it('rejects an IPv6 unique-local (fd00::/8) resolution', async () => {
    mockLookup.mockResolvedValue([{ address: 'fd00::1', family: 6 }]);
    expect((await resolveAndCheckHostname('v6.attacker.example')).allowed).toBe(false);
  });

  it('rejects a CGNAT 100.64.0.0/10 resolution', async () => {
    mockLookup.mockResolvedValue([{ address: '100.64.1.1', family: 4 }]);
    expect((await resolveAndCheckHostname('cgnat.attacker.example')).allowed).toBe(false);
  });

  it('allows a hostname that resolves only to public addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const result = await resolveAndCheckHostname('example.com');
    expect(result.allowed).toBe(true);
    expect(mockLookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
  });

  it('blocks a literal private IP via the fast path without resolving DNS', async () => {
    expect((await resolveAndCheckHostname('169.254.169.254')).allowed).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('fails CLOSED when DNS resolution fails (node:dns is available but lookup errored)', async () => {
    // A transient lookup failure does not prove the host is unreachable — the
    // fetch() would resolve independently and could still reach a private IP.
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect((await resolveAndCheckHostname('does-not-resolve.invalid')).allowed).toBe(false);
    await expect(
      assertHostNotSsrf('does-not-resolve.invalid', 'https://does-not-resolve.invalid/x'),
    ).rejects.toBeInstanceOf(CimdSecurityError);
  });
});
