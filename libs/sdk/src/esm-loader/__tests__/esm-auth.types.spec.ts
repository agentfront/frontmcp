import { resolveRegistryToken, getRegistryUrl, DEFAULT_NPM_REGISTRY, esmRegistryAuthSchema } from '../esm-auth.types';

describe('resolveRegistryToken', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return undefined when no auth provided', () => {
    expect(resolveRegistryToken()).toBeUndefined();
    expect(resolveRegistryToken(undefined)).toBeUndefined();
  });

  it('should return direct token', () => {
    expect(resolveRegistryToken({ token: 'my-token-123' })).toBe('my-token-123');
  });

  it('should resolve token from environment variable', () => {
    process.env.MY_NPM_TOKEN = 'env-token-456';
    expect(resolveRegistryToken({ tokenEnvVar: 'MY_NPM_TOKEN' })).toBe('env-token-456');
  });

  it('should throw when env var is not set', () => {
    expect(() => resolveRegistryToken({ tokenEnvVar: 'NONEXISTENT_VAR' })).toThrow(
      'Environment variable "NONEXISTENT_VAR" is not set',
    );
  });

  it('should return undefined when auth has no token or tokenEnvVar', () => {
    expect(resolveRegistryToken({})).toBeUndefined();
    expect(resolveRegistryToken({ registryUrl: 'https://example.com' })).toBeUndefined();
  });
});

describe('getRegistryUrl', () => {
  it('should return default registry when no auth provided', () => {
    expect(getRegistryUrl()).toBe(DEFAULT_NPM_REGISTRY);
    expect(getRegistryUrl(undefined)).toBe(DEFAULT_NPM_REGISTRY);
  });

  it('should return default registry when no registryUrl in auth', () => {
    expect(getRegistryUrl({ token: 'abc' })).toBe(DEFAULT_NPM_REGISTRY);
  });

  it('should return custom registry URL', () => {
    expect(getRegistryUrl({ registryUrl: 'https://npm.pkg.github.com' })).toBe('https://npm.pkg.github.com');
  });
});

describe('esmRegistryAuthSchema', () => {
  it('should validate valid auth with token', () => {
    const result = esmRegistryAuthSchema.safeParse({ token: 'abc123' });
    expect(result.success).toBe(true);
  });

  it('should validate valid auth with tokenEnvVar', () => {
    const result = esmRegistryAuthSchema.safeParse({ tokenEnvVar: 'NPM_TOKEN' });
    expect(result.success).toBe(true);
  });

  it('should validate auth with registryUrl', () => {
    const result = esmRegistryAuthSchema.safeParse({
      registryUrl: 'https://npm.pkg.github.com',
      token: 'abc',
    });
    expect(result.success).toBe(true);
  });

  it('should reject auth with both token and tokenEnvVar', () => {
    const result = esmRegistryAuthSchema.safeParse({
      token: 'abc',
      tokenEnvVar: 'NPM_TOKEN',
    });
    expect(result.success).toBe(false);
  });

  it('should validate empty auth', () => {
    const result = esmRegistryAuthSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
