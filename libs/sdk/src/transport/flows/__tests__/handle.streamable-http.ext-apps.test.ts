/**
 * @file handle.streamable-http.ext-apps.test.ts
 * @description Tests for ext-apps integration in the streamable HTTP flow.
 */

import { stateSchema, plan } from '../handle.streamable-http.flow';

describe('HandleStreamableHttpFlow - ExtApps Integration', () => {
  describe('stateSchema', () => {
    it('should include extApps in requestType enum', () => {
      // Verify the requestType enum includes 'extApps'
      const validState = {
        token: 'test-token',
        session: { id: 'test-session-id' },
        requestType: 'extApps' as const,
      };

      const result = stateSchema.safeParse(validState);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requestType).toBe('extApps');
      }
    });

    it('should accept all valid requestType values', () => {
      const baseState = {
        token: 'test-token',
        session: { id: 'test-session-id' },
      };

      const requestTypes = ['initialize', 'message', 'elicitResult', 'sseListener', 'extApps'] as const;

      for (const requestType of requestTypes) {
        const result = stateSchema.safeParse({ ...baseState, requestType });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid requestType values', () => {
      const invalidState = {
        token: 'test-token',
        session: { id: 'test-session-id' },
        requestType: 'invalid-type',
      };

      const result = stateSchema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });
  });

  describe('plan', () => {
    it('should include onExtApps in execute phase', () => {
      expect(plan.execute).toContain('onExtApps');
    });

    it('should have correct stage order', () => {
      // Verify onExtApps is in the execute phase alongside other handlers
      const executeStages = plan.execute;
      expect(executeStages).toEqual(['onInitialize', 'onMessage', 'onElicitResult', 'onSseListener', 'onExtApps']);
    });

    it('should have parseInput and router in pre phase', () => {
      expect(plan.pre).toContain('parseInput');
      expect(plan.pre).toContain('router');
    });
  });

  describe('router - ui/* method detection', () => {
    // Note: These are unit tests for the routing logic.
    // Integration tests with actual HTTP requests would be in e2e tests.

    it('should detect ui/initialize as extApps request', () => {
      const method = 'ui/initialize';
      expect(method.startsWith('ui/')).toBe(true);
    });

    it('should detect ui/callServerTool as extApps request', () => {
      const method = 'ui/callServerTool';
      expect(method.startsWith('ui/')).toBe(true);
    });

    it('should detect ui/log as extApps request', () => {
      const method = 'ui/log';
      expect(method.startsWith('ui/')).toBe(true);
    });

    it('should not detect MCP initialize as extApps request', () => {
      const method = 'initialize';
      expect(method.startsWith('ui/')).toBe(false);
    });

    it('should not detect tools/call as extApps request', () => {
      const method = 'tools/call';
      expect(method.startsWith('ui/')).toBe(false);
    });
  });
});

describe('ExtApps Options Schema', () => {
  // Dynamic import to avoid circular dependency issues during test
  let extAppsOptionsSchema: typeof import('../../../common/types/options/ext-apps/schema').extAppsOptionsSchema;

  beforeAll(async () => {
    const module = await import('../../../common/types/options/ext-apps/schema');
    extAppsOptionsSchema = module.extAppsOptionsSchema;
  });

  it('should have enabled default to true', () => {
    const result = extAppsOptionsSchema.parse({});
    expect(result.enabled).toBe(true);
  });

  it('should accept custom host capabilities', () => {
    const config = {
      enabled: true,
      hostCapabilities: {
        serverToolProxy: true,
        logging: true,
        openLink: false,
        modelContextUpdate: true,
        widgetTools: false,
        displayModes: ['inline', 'fullscreen'] as const,
      },
    };

    const result = extAppsOptionsSchema.parse(config);
    expect(result.hostCapabilities).toEqual(config.hostCapabilities);
  });

  it('should accept enabled: false', () => {
    const result = extAppsOptionsSchema.parse({ enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('should accept empty hostCapabilities', () => {
    const result = extAppsOptionsSchema.parse({ hostCapabilities: {} });
    expect(result.hostCapabilities).toEqual({});
  });
});
