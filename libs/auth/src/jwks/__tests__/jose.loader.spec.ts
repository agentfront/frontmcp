import { loadJose } from '../jose.loader';

describe('loadJose', () => {
  it('loads jose', async () => {
    const jose = await loadJose();
    expect(typeof jose.jwtVerify).toBe('function');
    expect(typeof jose.createLocalJWKSet).toBe('function');
    expect(typeof jose.decodeProtectedHeader).toBe('function');
  });

  it('loads it once', () => {
    expect(loadJose()).toBe(loadJose());
  });
});
