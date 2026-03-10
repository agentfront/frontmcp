import { resolveSessionIdGenerator } from '../transport.streamable-http.adapter';

describe('resolveSessionIdGenerator', () => {
  it('returns undefined for stateless transports so they can reinitialize', () => {
    expect(resolveSessionIdGenerator('stateless-http', '__stateless__')).toBeUndefined();
  });

  it('returns a stable generator for stateful transports', () => {
    const generator = resolveSessionIdGenerator('streamable-http', 'session-123');
    expect(typeof generator).toBe('function');
    expect(generator?.()).toBe('session-123');
  });
});
