import { detectProvider, resetProviderCacheForTesting } from '../provider';

describe('detectProvider (issue #417)', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetProviderCacheForTesting();
    // Wipe all provider-discriminating env vars so each test is isolated.
    for (const key of [
      'FRONTMCP_PROVIDER',
      'VERCEL',
      'AWS_LAMBDA_FUNCTION_NAME',
      'CF_PAGES',
      'NETLIFY',
      'AZURE_FUNCTIONS_ENVIRONMENT',
      'K_SERVICE',
      'FLY_APP_NAME',
      'RENDER',
      'RAILWAY_ENVIRONMENT',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = { ...envBackup };
    resetProviderCacheForTesting();
  });

  it("returns 'bare' when no discriminating env var is set (non-Docker)", () => {
    expect(['bare', 'docker']).toContain(detectProvider());
  });

  it.each([
    ['VERCEL', '1', 'vercel'],
    ['AWS_LAMBDA_FUNCTION_NAME', 'my-fn', 'lambda'],
    ['CF_PAGES', '1', 'cloudflare'],
    ['NETLIFY', '1', 'netlify'],
    ['AZURE_FUNCTIONS_ENVIRONMENT', 'Development', 'azure'],
    ['K_SERVICE', 'my-service', 'gcp'],
    ['FLY_APP_NAME', 'my-app', 'fly'],
    ['RENDER', '1', 'render'],
    ['RAILWAY_ENVIRONMENT', 'production', 'railway'],
  ])('detects %s → %s', (envKey, envValue, expected) => {
    process.env[envKey] = envValue;
    resetProviderCacheForTesting();
    expect(detectProvider()).toBe(expected);
  });

  it('FRONTMCP_PROVIDER override beats every other env var', () => {
    process.env['FRONTMCP_PROVIDER'] = 'docker';
    process.env['VERCEL'] = '1';
    resetProviderCacheForTesting();
    expect(detectProvider()).toBe('docker');
  });

  it('ignores FRONTMCP_PROVIDER values outside the known list', () => {
    process.env['FRONTMCP_PROVIDER'] = 'unknown-platform';
    resetProviderCacheForTesting();
    expect(['bare', 'docker']).toContain(detectProvider());
  });

  it('caches the result across calls', () => {
    process.env['VERCEL'] = '1';
    resetProviderCacheForTesting();
    expect(detectProvider()).toBe('vercel');
    delete process.env['VERCEL'];
    // Cached — still vercel
    expect(detectProvider()).toBe('vercel');
  });
});
