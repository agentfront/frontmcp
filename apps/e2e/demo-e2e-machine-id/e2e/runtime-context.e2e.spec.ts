/**
 * E2E Tests for RuntimeContext deployment detection.
 *
 * Tests that getRuntimeContext() correctly detects deployment mode
 * based on FRONTMCP_DEPLOYMENT_MODE environment variable.
 */

import { FrontMcpInstance, type DirectMcpServer } from '@frontmcp/sdk';
import { getRuntimeContext, resetRuntimeContext } from '@frontmcp/utils';

import { serverConfig } from '../src/main';

describe('RuntimeContext E2E', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    server = await FrontMcpInstance.createDirect(serverConfig);
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('should return runtime context via tool', async () => {
    const result = await server.callTool('get_runtime_context', {});
    expect(result.isError).not.toBe(true);

    const ctx = JSON.parse((result.content[0] as { text: string }).text);
    expect(ctx.platform).toBe(process.platform);
    expect(ctx.runtime).toBe('node');
    expect(typeof ctx.deployment).toBe('string');
    expect(typeof ctx.env).toBe('string');
  });

  it('should return deployment mode via tool', async () => {
    const result = await server.callTool('get_deployment_mode', {});
    expect(result.isError).not.toBe(true);

    const content = JSON.parse((result.content[0] as { text: string }).text);
    expect(content.deployment).toBeDefined();
    // Default should be 'standalone' in test environment
    expect(content.deployment).toBe('standalone');
  });

  it('should detect standalone as default deployment', () => {
    // Direct API call (no tool)
    const ctx = getRuntimeContext();
    expect(ctx.deployment).toBe('standalone');
    expect(ctx.runtime).toBe('node');
    expect(ctx.platform).toBe(process.platform);
  });

  it('should detect distributed when FRONTMCP_DEPLOYMENT_MODE is set', () => {
    const originalMode = process.env['FRONTMCP_DEPLOYMENT_MODE'];
    try {
      process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'distributed';
      resetRuntimeContext(); // Clear cached singleton

      const ctx = getRuntimeContext();
      expect(ctx.deployment).toBe('distributed');
    } finally {
      if (originalMode) {
        process.env['FRONTMCP_DEPLOYMENT_MODE'] = originalMode;
      } else {
        delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
      }
      resetRuntimeContext();
    }
  });

  it('should detect serverless when FRONTMCP_DEPLOYMENT_MODE is set', () => {
    const originalMode = process.env['FRONTMCP_DEPLOYMENT_MODE'];
    try {
      process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
      resetRuntimeContext();

      const ctx = getRuntimeContext();
      expect(ctx.deployment).toBe('serverless');
    } finally {
      if (originalMode) {
        process.env['FRONTMCP_DEPLOYMENT_MODE'] = originalMode;
      } else {
        delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
      }
      resetRuntimeContext();
    }
  });

  it('should include all required fields', () => {
    const ctx = getRuntimeContext();
    expect(ctx).toHaveProperty('platform');
    expect(ctx).toHaveProperty('runtime');
    expect(ctx).toHaveProperty('deployment');
    expect(ctx).toHaveProperty('env');
  });
});
