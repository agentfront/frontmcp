import { resolveSessionIdGenerator } from '../transport.streamable-http.adapter';

describe('resolveSessionIdGenerator', () => {
  it('returns a generator yielding __stateless__ for stateless transports', () => {
    const generator = resolveSessionIdGenerator('stateless-http', '__stateless__');
    expect(typeof generator).toBe('function');
    expect(generator?.()).toBe('__stateless__');
  });

  it('returns a stable generator for stateful transports', () => {
    const generator = resolveSessionIdGenerator('streamable-http', 'session-123');
    expect(typeof generator).toBe('function');
    expect(generator?.()).toBe('session-123');
  });
});
