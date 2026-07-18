/**
 * DcrClientRegistry — dynamic-registration cap (resource-exhaustion guard).
 *
 * DCR (`POST /oauth/register`) may be unauthenticated; without a bound an
 * attacker can register unlimited clients and exhaust memory. The registry caps
 * dynamic clients and REJECTS new registrations once the cap is reached (rather
 * than evicting an existing client), preserving every already-registered client
 * — including confidential ones — and never counting pre-registered /
 * declarative clients toward the cap.
 */
import { DcrClientRegistry, type RegisteredClient } from '../dcr-client.registry';

function mkClient(id: string, createdAt: number, opts: Partial<RegisteredClient> = {}): RegisteredClient {
  return {
    client_id: id,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['http://localhost/cb'],
    created_at: createdAt,
    dev: true,
    ...opts,
  };
}

describe('DcrClientRegistry — dynamic registration cap', () => {
  it('rejects new registrations once the cap is reached and retains existing clients', () => {
    const registry = new DcrClientRegistry({ maxDynamicClients: 3 });
    expect(registry.register(mkClient('c1', 100))).toBe(true);
    expect(registry.register(mkClient('c2', 200))).toBe(true);
    expect(registry.register(mkClient('c3', 300))).toBe(true);

    // Cap reached → the 4th registration is rejected.
    expect(registry.register(mkClient('c4', 400))).toBe(false);

    // c1..c3 are all retained; c4 was never stored.
    expect(registry.has('c1')).toBe(true);
    expect(registry.has('c2')).toBe(true);
    expect(registry.has('c3')).toBe(true);
    expect(registry.has('c4')).toBe(false);
  });

  it('preserves an existing confidential client instead of evicting it', () => {
    const registry = new DcrClientRegistry({ maxDynamicClients: 2 });
    registry.register(mkClient('conf', 100, { token_endpoint_auth_method: 'client_secret_post', client_secret: 's' }));
    registry.register(mkClient('c2', 200));

    // Cap reached — a new registration is rejected, and the confidential client stays.
    expect(registry.register(mkClient('c3', 300))).toBe(false);
    expect(registry.has('conf')).toBe(true);
    expect((registry.get('conf') as RegisteredClient).client_secret).toBe('s');
  });

  it('keeps at most `cap` dynamic clients across many attempts (the FIRST cap survive)', () => {
    const registry = new DcrClientRegistry({ maxDynamicClients: 5 });
    let accepted = 0;
    for (let i = 0; i < 100; i++) if (registry.register(mkClient(`c${i}`, i))) accepted++;
    expect(accepted).toBe(5);
    const remaining = Array.from({ length: 100 }, (_, i) => `c${i}`).filter((id) => registry.has(id));
    expect(remaining).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });

  it('allows re-registering (updating) an existing dynamic client id even at capacity', () => {
    const registry = new DcrClientRegistry({ maxDynamicClients: 1 });
    expect(registry.register(mkClient('c1', 100))).toBe(true);
    // Same id → update, not growth → allowed even though the cap is reached.
    expect(registry.register(mkClient('c1', 100, { client_name: 'renamed' }))).toBe(true);
    expect((registry.get('c1') as RegisteredClient).client_name).toBe('renamed');
  });

  it('never counts pre-registered/declarative clients toward the cap', () => {
    const registry = new DcrClientRegistry({
      maxDynamicClients: 1,
      clients: [{ clientId: 'trusted', redirectUris: ['http://localhost/cb'] }],
    });
    expect(registry.register(mkClient('dyn1', 100))).toBe(true); // 1 dynamic → at cap
    expect(registry.register(mkClient('dyn2', 200))).toBe(false); // rejected

    expect(registry.has('trusted')).toBe(true);
    expect(registry.has('dyn1')).toBe(true);
    expect(registry.has('dyn2')).toBe(false);
  });

  it('falls back to the 1000 default cap for every invalid maxDynamicClients (negative/NaN/fractional/infinite)', () => {
    for (const bad of [-1, NaN, 1.5, Infinity]) {
      const registry = new DcrClientRegistry({ maxDynamicClients: bad as number });
      // The default fallback (1000) must apply exactly: 1000 accepted, 1001st rejected.
      for (let i = 0; i < 1000; i++) {
        expect(registry.register(mkClient(`c${i}`, i))).toBe(true);
      }
      expect(registry.register(mkClient('c1000', 1000))).toBe(false);
    }
  });
});
