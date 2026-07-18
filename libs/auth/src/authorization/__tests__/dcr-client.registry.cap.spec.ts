/**
 * DcrClientRegistry — dynamic-registration cap (resource-exhaustion guard).
 *
 * DCR (`POST /oauth/register`) may be unauthenticated; without a bound an
 * attacker can register unlimited clients and exhaust memory. The registry caps
 * dynamic clients (FIFO eviction of the oldest) while never evicting
 * pre-registered / declarative clients.
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
  it('evicts the oldest dynamic clients once the cap is exceeded', () => {
    const registry = new DcrClientRegistry({ maxDynamicClients: 3 });
    registry.register(mkClient('c1', 100));
    registry.register(mkClient('c2', 200));
    registry.register(mkClient('c3', 300));
    registry.register(mkClient('c4', 400)); // exceeds cap → evict oldest (c1)

    expect(registry.has('c1')).toBe(false);
    expect(registry.has('c2')).toBe(true);
    expect(registry.has('c3')).toBe(true);
    expect(registry.has('c4')).toBe(true);
  });

  it('keeps only `cap` dynamic clients after many registrations', () => {
    const registry = new DcrClientRegistry({ maxDynamicClients: 5 });
    for (let i = 0; i < 100; i++) registry.register(mkClient(`c${i}`, i));
    const remaining = Array.from({ length: 100 }, (_, i) => `c${i}`).filter((id) => registry.has(id));
    expect(remaining.length).toBe(5);
    // The survivors are the most-recent five.
    expect(remaining).toEqual(['c95', 'c96', 'c97', 'c98', 'c99']);
  });

  it('never evicts pre-registered/declarative clients', () => {
    const registry = new DcrClientRegistry({
      maxDynamicClients: 1,
      clients: [{ clientId: 'trusted', redirectUris: ['http://localhost/cb'] }],
    });
    registry.register(mkClient('dyn1', 100));
    registry.register(mkClient('dyn2', 200)); // evicts dyn1, not the pre-registered client

    expect(registry.has('trusted')).toBe(true);
    expect(registry.has('dyn2')).toBe(true);
    expect(registry.has('dyn1')).toBe(false);
  });

  it('defaults to a generous cap (1000) when unconfigured', () => {
    const registry = new DcrClientRegistry();
    for (let i = 0; i < 1001; i++) registry.register(mkClient(`c${i}`, i));
    expect(registry.has('c0')).toBe(false); // oldest evicted at 1001
    expect(registry.has('c1000')).toBe(true);
  });
});
