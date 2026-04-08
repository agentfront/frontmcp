import { detectRuntimeContext, resetRuntimeContext } from '../runtime-context';

describe('detectRuntimeContext — deployment modes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRuntimeContext();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetRuntimeContext();
  });

  it('should detect distributed mode from FRONTMCP_DEPLOYMENT_MODE', () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
    const ctx = detectRuntimeContext();
    expect(ctx.deployment).toBe('distributed');
  });

  it('should detect serverless mode from FRONTMCP_DEPLOYMENT_MODE', () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
    const ctx = detectRuntimeContext();
    expect(ctx.deployment).toBe('serverless');
  });

  it('should detect serverless from platform env vars when FRONTMCP_DEPLOYMENT_MODE not set', () => {
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    process.env['VERCEL'] = '1';
    const ctx = detectRuntimeContext();
    expect(ctx.deployment).toBe('serverless');
    delete process.env['VERCEL'];
  });

  it('should default to standalone when no signals present', () => {
    delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
    delete process.env['VERCEL'];
    delete process.env['AWS_LAMBDA_FUNCTION_NAME'];
    const ctx = detectRuntimeContext();
    expect(ctx.deployment).toBe('standalone');
  });

  it('should prioritize explicit FRONTMCP_DEPLOYMENT_MODE over platform detection', () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
    process.env['VERCEL'] = '1'; // Would normally trigger serverless
    const ctx = detectRuntimeContext();
    expect(ctx.deployment).toBe('distributed');
    delete process.env['VERCEL'];
  });

  it('should include platform and runtime fields', () => {
    const ctx = detectRuntimeContext();
    expect(ctx.platform).toBe(process.platform);
    expect(ctx.runtime).toBe('node');
    expect(typeof ctx.env).toBe('string');
  });
});
