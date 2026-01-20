/**
 * E2E Tests for ConfigPlugin
 *
 * Tests environment variable loading behavior:
 * - Get config values with defaults
 * - Get required config values
 * - Local env overrides base env
 * - getNumber and getBoolean helpers
 * - Error handling for missing required values
 */
import { test, expect } from '@frontmcp/testing';

// Enable verbose logging only when DEBUG_E2E is set
const DEBUG = process.env['DEBUG_E2E'] === '1';

test.describe('Config Plugin E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-config/src/main.ts',
    publicMode: true,
    logLevel: DEBUG ? 'debug' : 'warn',
  });

  test.describe('Tool Discovery', () => {
    test('should list all config tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      expect(tools).toContainTool('get-config');
      expect(tools).toContainTool('get-required-config');
      expect(tools).toContainTool('get-all-config');
      expect(tools).toContainTool('check-config');
    });
  });

  test.describe('Get Config Operations', () => {
    test('should get config value that exists', async ({ mcp }) => {
      const result = await mcp.tools.call('get-config', {
        key: 'DATABASE_URL',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":true');
      expect(result).toHaveTextContent('postgres://localhost:5432/testdb');
    });

    test('should return null for non-existent key without default', async ({ mcp }) => {
      const result = await mcp.tools.call('get-config', {
        key: 'NON_EXISTENT_KEY',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":false');
      expect(result).toHaveTextContent('"value":null');
    });

    test('should use default value for non-existent key', async ({ mcp }) => {
      const result = await mcp.tools.call('get-config', {
        key: 'NON_EXISTENT_KEY',
        defaultValue: 'my-default-value',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":false');
      expect(result).toHaveTextContent('"defaultUsed":true');
      expect(result).toHaveTextContent('my-default-value');
    });

    test('should not use default when key exists', async ({ mcp }) => {
      const result = await mcp.tools.call('get-config', {
        key: 'APP_NAME',
        defaultValue: 'fallback-name',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":true');
      expect(result).toHaveTextContent('"defaultUsed":false');
      expect(result).toHaveTextContent('ConfigPluginE2E');
    });
  });

  test.describe('Local Env Override', () => {
    test('should override base env with local env', async ({ mcp }) => {
      // API_KEY is "test-api-key-12345" in .env but "local-override-key" in .env.local
      const result = await mcp.tools.call('get-config', {
        key: 'API_KEY',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":true');
      expect(result).toHaveTextContent('local-override-key');
    });

    test('should have local-only variable from .env.local', async ({ mcp }) => {
      const result = await mcp.tools.call('get-config', {
        key: 'LOCAL_ONLY_VAR',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"found":true');
      expect(result).toHaveTextContent('from-local-env');
    });
  });

  test.describe('Get Required Config Operations', () => {
    test('should get required config value that exists', async ({ mcp }) => {
      const result = await mcp.tools.call('get-required-config', {
        key: 'DATABASE_URL',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"success":true');
      expect(result).toHaveTextContent('postgres://localhost:5432/testdb');
    });

    test('should return error for missing required config', async ({ mcp }) => {
      const result = await mcp.tools.call('get-required-config', {
        key: 'COMPLETELY_MISSING_VAR',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"success":false');
      expect(result).toHaveTextContent('error');
      expect(result).toHaveTextContent('COMPLETELY_MISSING_VAR');
    });
  });

  test.describe('Get All Config Operations', () => {
    test('should return config count and keys', async ({ mcp }) => {
      const result = await mcp.tools.call('get-all-config', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('count');
      expect(result).toHaveTextContent('keys');
      expect(result).toHaveTextContent('DATABASE_URL');
      expect(result).toHaveTextContent('API_KEY');
    });

    test('should include sample values', async ({ mcp }) => {
      const result = await mcp.tools.call('get-all-config', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('sample');
      // The sample should show the overridden API_KEY from .env.local
      expect(result).toHaveTextContent('local-override-key');
    });
  });

  test.describe('Check Config Operations', () => {
    test('should check if config key exists', async ({ mcp }) => {
      const result = await mcp.tools.call('check-config', {
        key: 'DATABASE_URL',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"exists":true');
    });

    test('should return false for non-existent key', async ({ mcp }) => {
      const result = await mcp.tools.call('check-config', {
        key: 'DOES_NOT_EXIST',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"exists":false');
    });

    test('should parse number values correctly', async ({ mcp }) => {
      // PORT is a number (value may be overridden by test framework)
      const result = await mcp.tools.call('check-config', {
        key: 'PORT',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"isNumber":true');
      // numberValue should be a number, not null
      expect(result).not.toHaveTextContent('"numberValue":null');
    });

    test('should return NaN indicator for non-numeric values', async ({ mcp }) => {
      // DATABASE_URL is a string, not a number
      const result = await mcp.tools.call('check-config', {
        key: 'DATABASE_URL',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"isNumber":false');
      expect(result).toHaveTextContent('"numberValue":null');
    });

    test('should parse boolean values correctly', async ({ mcp }) => {
      // DEBUG=true in .env
      const result = await mcp.tools.call('check-config', {
        key: 'DEBUG',
      });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('"booleanValue":true');
    });
  });

  test.describe('Error Scenarios', () => {
    test('should handle missing key parameter in get-config', async ({ mcp }) => {
      const result = await mcp.tools.call('get-config', {});

      expect(result).toBeError();
      expect(result).toHaveTextContent('key');
    });

    test('should handle missing key parameter in check-config', async ({ mcp }) => {
      const result = await mcp.tools.call('check-config', {});

      expect(result).toBeError();
      expect(result).toHaveTextContent('key');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Config Fallback Tests (withConfig auto-fallback feature)
  // ─────────────────────────────────────────────────────────────────────────────

  test.describe('Config Fallback Resolution', () => {
    test('should discover test-config-fallback tool', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools).toContainTool('test-config-fallback');
    });

    test.describe('Auto-Fallback (3-level chain)', () => {
      test('should resolve from entity-specific level first', async ({ mcp }) => {
        // AGENTS_RESEARCH_AGENT_OPENAIKEY=sk-research-agent-specific exists
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'openaiKey',
          entityType: 'agents',
          entityName: 'research-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"sk-research-agent-specific"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"AGENTS_RESEARCH_AGENT_OPENAIKEY"');
      });

      test('should fall back to entity-type level when specific not found', async ({ mcp }) => {
        // AGENTS_UNKNOWN_AGENT_OPENAIKEY doesn't exist
        // AGENTS_OPENAIKEY=sk-agents-default exists
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'openaiKey',
          entityType: 'agents',
          entityName: 'unknown-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"sk-agents-default"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"AGENTS_OPENAIKEY"');
      });

      test('should fall back to global level when entity-type not found', async ({ mcp }) => {
        // AGENTS_SOME_AGENT_ANTHROPICKEY doesn't exist
        // AGENTS_ANTHROPICKEY doesn't exist
        // ANTHROPICKEY=ak-global-key exists
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'anthropicKey',
          entityType: 'agents',
          entityName: 'some-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"ak-global-key"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"ANTHROPICKEY"');
      });

      test('should return null when key not found at any level', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'nonExistentKey',
          entityType: 'agents',
          entityName: 'test-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":null');
        expect(result).toHaveTextContent('"resolvedFromPath":null');
      });
    });

    test.describe('Name Normalization', () => {
      test('should normalize dashes to underscores', async ({ mcp }) => {
        // Entity name: "my-cool-agent" → normalized: "my_cool_agent"
        // AGENTS_MY_COOL_AGENT_OPENAIKEY exists
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'openaiKey',
          entityType: 'agents',
          entityName: 'my-cool-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"normalizedName":"my_cool_agent"');
        expect(result).toHaveTextContent('"resolvedValue":"sk-my-cool-agent-specific"');
      });

      test('should generate correct env key format', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'openaiKey',
          entityType: 'agents',
          entityName: 'research-agent',
        });

        expect(result).toBeSuccessful();
        // Should generate: AGENTS_RESEARCH_AGENT_OPENAIKEY, AGENTS_OPENAIKEY, OPENAIKEY
        // Note: camelCase keys become UPPERCASE without extra underscores
        expect(result).toHaveTextContent('AGENTS_RESEARCH_AGENT_OPENAIKEY');
        expect(result).toHaveTextContent('AGENTS_OPENAIKEY');
        expect(result).toHaveTextContent('"OPENAIKEY"');
      });
    });

    test.describe('Plugin Entity Type', () => {
      test('should resolve plugin-specific config', async ({ mcp }) => {
        // PLUGINS_MY_PLUGIN_REDISURL=redis://my-plugin-specific:6379
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'redisUrl',
          entityType: 'plugins',
          entityName: 'my-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"redis://my-plugin-specific:6379"');
      });

      test('should fall back to plugins default', async ({ mcp }) => {
        // PLUGINS_UNKNOWN_PLUGIN_REDISURL doesn't exist
        // PLUGINS_REDISURL=redis://plugins-default:6379 exists
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'redisUrl',
          entityType: 'plugins',
          entityName: 'unknown-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"redis://plugins-default:6379"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"PLUGINS_REDISURL"');
      });
    });

    test.describe('Custom Fallbacks Override', () => {
      test('should use custom fallback paths when provided', async ({ mcp }) => {
        // Custom fallbacks: try GLOBAL_ONLY_KEY directly
        // Using snake_case so it maps to GLOBAL_ONLY_KEY
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'openaiKey',
          entityType: 'agents',
          entityName: 'test-agent',
          customFallbacks: ['global_only_key'],
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"global-only-value"');
      });

      test('should try custom paths in order', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'someKey',
          entityType: 'agents',
          entityName: 'test-agent',
          customFallbacks: ['nonExistent', 'alsoNonExistent', 'global_only_key'],
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"global-only-value"');
        // Should have tried 3 paths
        expect(result).toHaveTextContent('"triedPaths"');
      });
    });

    test.describe('Disable Fallbacks', () => {
      test('should do direct lookup only when fallbacks disabled', async ({ mcp }) => {
        // With fallbacks disabled, only tries the exact key (no fallback chain)
        // Using a key that has entity-specific and type-level values but NO global value
        // AGENTS_TEST_AGENT_TESTKEY exists, AGENTS_TESTKEY exists, but without fallbacks
        // only "someUnknownKey" → "SOMEUNKNOWNKEY" is tried, which doesn't exist
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'someUnknownKey',
          entityType: 'agents',
          entityName: 'test-agent',
          disableFallbacks: true,
        });

        expect(result).toBeSuccessful();
        // Should only have one path in generatedPaths
        expect(result).toHaveTextContent('"generatedPaths":["someUnknownKey"]');
        // Should only have one env key tried
        expect(result).toHaveTextContent('"generatedEnvKeys":["SOMEUNKNOWNKEY"]');
        // Won't find it because SOMEUNKNOWNKEY doesn't exist
        expect(result).toHaveTextContent('"resolvedValue":null');
      });
    });

    test.describe('Full Fallback Chain Visibility', () => {
      test('should show all three levels in triedPaths', async ({ mcp }) => {
        // Using simple key "testKey" which becomes "TESTKEY" in env vars
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'testKey',
          entityType: 'agents',
          entityName: 'test-agent',
        });

        expect(result).toBeSuccessful();
        // All three levels exist, should resolve from agent-specific
        expect(result).toHaveTextContent('"resolvedValue":"agent-specific-level"');
        // triedPaths should show all three attempted lookups
        expect(result).toHaveTextContent('AGENTS_TEST_AGENT_TESTKEY');
        expect(result).toHaveTextContent('AGENTS_TESTKEY');
        expect(result).toHaveTextContent('"TESTKEY"');
      });

      test('should show values at each level in triedPaths', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'testKey',
          entityType: 'agents',
          entityName: 'test-agent',
        });

        expect(result).toBeSuccessful();
        // Each level should have its value in triedPaths
        expect(result).toHaveTextContent('agent-specific-level');
        expect(result).toHaveTextContent('agents-level');
        expect(result).toHaveTextContent('global-level');
      });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // Sophisticated Test Scenarios
    // ─────────────────────────────────────────────────────────────────────────────

    test.describe('Edge Cases: Special Characters in Entity Names', () => {
      test('should handle entity names with multiple consecutive dashes', async ({ mcp }) => {
        // "agent--with---dashes" → normalized: "agent__with___dashes"
        // Env key: AGENTS_AGENT__WITH___DASHES_SPECIALKEY
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'specialKey',
          entityType: 'agents',
          entityName: 'agent--with---dashes',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"normalizedName":"agent__with___dashes"');
        expect(result).toHaveTextContent('"resolvedValue":"agent-multi-dash-value"');
      });

      test('should handle entity names with dots', async ({ mcp }) => {
        // "agent.with.dots" → normalized: "agent_with_dots"
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'specialKey',
          entityType: 'agents',
          entityName: 'agent.with.dots',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"normalizedName":"agent_with_dots"');
        expect(result).toHaveTextContent('"resolvedValue":"agent-dots-value"');
      });

      test('should handle entity names with spaces', async ({ mcp }) => {
        // "agent with spaces" → normalized: "agent_with_spaces"
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'specialKey',
          entityType: 'agents',
          entityName: 'agent with spaces',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"normalizedName":"agent_with_spaces"');
        expect(result).toHaveTextContent('"resolvedValue":"agent-spaces-value"');
      });

      test('should handle mixed case entity names', async ({ mcp }) => {
        // "MixedCaseAgent" → normalized: "mixedcaseagent"
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'specialKey',
          entityType: 'agents',
          entityName: 'MixedCaseAgent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"normalizedName":"mixedcaseagent"');
        expect(result).toHaveTextContent('"resolvedValue":"agent-mixed-case-value"');
      });

      test('should handle entity names with numbers', async ({ mcp }) => {
        // "agent123" → normalized: "agent123"
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'specialKey',
          entityType: 'agents',
          entityName: 'agent123',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"normalizedName":"agent123"');
        expect(result).toHaveTextContent('"resolvedValue":"agent-numeric-value"');
      });
    });

    test.describe('Edge Cases: Special Values', () => {
      test('should handle empty string values', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'emptyValue',
          entityType: 'agents',
          entityName: 'any-agent',
        });

        expect(result).toBeSuccessful();
        // Empty string should be found (value exists, just empty)
        expect(result).toHaveTextContent('"resolvedValue":""');
      });

      test('should handle very long values', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'longValue',
          entityType: 'agents',
          entityName: 'any-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('this-is-a-very-long-configuration-value');
      });

      test('should handle unicode values', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'unicodeValue',
          entityType: 'agents',
          entityName: 'any-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('Hello-世界-🌍');
      });

      test('should handle JSON-like string values', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'configJson',
          entityType: 'agents',
          entityName: 'any-agent',
        });

        expect(result).toBeSuccessful();
        // Should get the agents-level JSON value (escaped in the output)
        expect(result).toHaveTextContent('\\"level\\":\\"agents\\"');
        expect(result).toHaveTextContent('\\"extra\\":true');
      });
    });

    test.describe('Partial Fallback Chain', () => {
      test('should find value when only global level exists', async ({ mcp }) => {
        // GLOBALONLY exists only at global level
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'globalOnly',
          entityType: 'agents',
          entityName: 'some-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"global-only-value-isolated"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"GLOBALONLY"');
      });

      test('should find value when only entity-type level exists', async ({ mcp }) => {
        // ADAPTERS_TYPEONLY exists only at adapters type level
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'typeOnly',
          entityType: 'adapters',
          entityName: 'some-adapter',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"adapters-type-only-value"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"ADAPTERS_TYPEONLY"');
      });

      test('should find value when only entity-specific level exists', async ({ mcp }) => {
        // PLUGINS_ISOLATED_PLUGIN_SPECIFICONLY exists only at specific plugin level
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'specificOnly',
          entityType: 'plugins',
          entityName: 'isolated-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"plugin-specific-only-value"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"PLUGINS_ISOLATED_PLUGIN_SPECIFICONLY"');
      });

      test('should not find value in wrong entity type partial chain', async ({ mcp }) => {
        // ADAPTERS_TYPEONLY exists but we're querying for agents
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'typeOnly',
          entityType: 'agents',
          entityName: 'some-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":null');
      });
    });

    test.describe('Cross-Entity Type Isolation', () => {
      test('should resolve agent-specific value for agents', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'sharedKey',
          entityType: 'agents',
          entityName: 'alpha-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"alpha-agent-shared"');
      });

      test('should resolve plugin-specific value for plugins', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'sharedKey',
          entityType: 'plugins',
          entityName: 'alpha-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"alpha-plugin-shared"');
      });

      test('should resolve adapter-specific value for adapters', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'sharedKey',
          entityType: 'adapters',
          entityName: 'alpha-adapter',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"alpha-adapter-shared"');
      });

      test('should fall back to type level for unknown entity within type', async ({ mcp }) => {
        // Unknown agent should fall back to AGENTS_SHAREDKEY
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'sharedKey',
          entityType: 'agents',
          entityName: 'unknown-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"agents-shared"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"AGENTS_SHAREDKEY"');
      });

      test('should fall back to global when no type-specific exists', async ({ mcp }) => {
        // Using a key that only has global value
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'globalOnly',
          entityType: 'plugins',
          entityName: 'any-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"global-only-value-isolated"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"GLOBALONLY"');
      });
    });

    test.describe('Precedence Verification', () => {
      test('entity-specific should override entity-type and global', async ({ mcp }) => {
        // data-processor has specific batchSize=100, agents default=50, global=25
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'batchSize',
          entityType: 'agents',
          entityName: 'data-processor',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"100"');
      });

      test('entity-type should override global when no specific exists', async ({ mcp }) => {
        // unknown-processor has no specific, should get agents default=50
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'batchSize',
          entityType: 'agents',
          entityName: 'unknown-processor',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"50"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"AGENTS_BATCHSIZE"');
      });

      test('global should be used when no entity levels exist', async ({ mcp }) => {
        // plugins have no batchSize at any level, should get global=25
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'batchSize',
          entityType: 'plugins',
          entityName: 'any-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"25"');
        expect(result).toHaveTextContent('"resolvedFromEnvKey":"BATCHSIZE"');
      });

      test('should show full precedence chain in triedPaths', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'batchSize',
          entityType: 'agents',
          entityName: 'data-processor',
        });

        expect(result).toBeSuccessful();
        // Should see all three levels with their values
        expect(result).toHaveTextContent('"value":"100"'); // entity-specific
        expect(result).toHaveTextContent('"value":"50"'); // entity-type
        expect(result).toHaveTextContent('"value":"25"'); // global
      });
    });

    test.describe('Numeric and Boolean-like Values', () => {
      test('should resolve numeric values correctly at different levels', async ({ mcp }) => {
        // PLUGINS_DB_PLUGIN_MAXCONNECTIONS=50
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'maxConnections',
          entityType: 'plugins',
          entityName: 'db-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"50"');
      });

      test('should resolve boolean-like string values', async ({ mcp }) => {
        // AGENTS_FEATURE_AGENT_FEATUREFLAG=enabled
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'featureFlag',
          entityType: 'agents',
          entityName: 'feature-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"enabled"');
      });

      test('should fall back to type-level boolean value', async ({ mcp }) => {
        // Unknown agent should get AGENTS_FEATUREFLAG=true
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'featureFlag',
          entityType: 'agents',
          entityName: 'unknown-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"true"');
      });
    });

    test.describe('URL Values', () => {
      test('should resolve URL values with entity-specific override', async ({ mcp }) => {
        // AGENTS_NOTIFIER_AGENT_WEBHOOKURL
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'webhookUrl',
          entityType: 'agents',
          entityName: 'notifier-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('https://notifier.example.com/webhook');
      });

      test('should fall back to type-level URL', async ({ mcp }) => {
        // AGENTS_WEBHOOKURL
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'webhookUrl',
          entityType: 'agents',
          entityName: 'other-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('https://agents.example.com/webhook');
      });

      test('should fall back to global URL', async ({ mcp }) => {
        // WEBHOOKURL (global)
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'webhookUrl',
          entityType: 'plugins',
          entityName: 'any-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('https://global.example.com/webhook');
      });
    });

    test.describe('Multiple Config Keys for Same Entity', () => {
      test('should resolve multiple keys for data-processor agent', async ({ mcp }) => {
        // Test batchSize
        const batchResult = await mcp.tools.call('test-config-fallback', {
          key: 'batchSize',
          entityType: 'agents',
          entityName: 'data-processor',
        });
        expect(batchResult).toBeSuccessful();
        expect(batchResult).toHaveTextContent('"resolvedValue":"100"');

        // Test timeout
        const timeoutResult = await mcp.tools.call('test-config-fallback', {
          key: 'timeout',
          entityType: 'agents',
          entityName: 'data-processor',
        });
        expect(timeoutResult).toBeSuccessful();
        expect(timeoutResult).toHaveTextContent('"resolvedValue":"30000"');

        // Test retryCount
        const retryResult = await mcp.tools.call('test-config-fallback', {
          key: 'retryCount',
          entityType: 'agents',
          entityName: 'data-processor',
        });
        expect(retryResult).toBeSuccessful();
        expect(retryResult).toHaveTextContent('"resolvedValue":"3"');
      });
    });

    test.describe('Custom Fallbacks with Complex Paths', () => {
      test('should try multiple custom fallbacks in order', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'anyKey',
          entityType: 'agents',
          entityName: 'any-agent',
          customFallbacks: [
            'nonexistent1',
            'nonexistent2',
            'nonexistent3',
            'global_only_key', // This one exists
          ],
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":"global-only-value"');
      });

      test('should return null when all custom fallbacks fail', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'anyKey',
          entityType: 'agents',
          entityName: 'any-agent',
          customFallbacks: ['nonexistent1', 'nonexistent2', 'nonexistent3'],
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"resolvedValue":null');
      });

      test('should use first matching custom fallback even if later ones exist', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'anyKey',
          entityType: 'agents',
          entityName: 'any-agent',
          customFallbacks: ['testKey', 'global_only_key'], // Both exist, testKey should win
        });

        expect(result).toBeSuccessful();
        // testKey maps to TESTKEY which is global-level
        expect(result).toHaveTextContent('"resolvedValue":"global-level"');
      });
    });

    test.describe('All Entity Types Coverage', () => {
      test('should work with agents entity type', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'openaiKey',
          entityType: 'agents',
          entityName: 'test-agent',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"entityType":"agents"');
        expect(result).toHaveTextContent('AGENTS_');
      });

      test('should work with plugins entity type', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'redisUrl',
          entityType: 'plugins',
          entityName: 'test-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"entityType":"plugins"');
        expect(result).toHaveTextContent('PLUGINS_');
      });

      test('should work with adapters entity type', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'sharedKey',
          entityType: 'adapters',
          entityName: 'test-adapter',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('"entityType":"adapters"');
        expect(result).toHaveTextContent('ADAPTERS_');
      });
    });

    test.describe('Generated Paths Verification', () => {
      test('should generate correct path structure for agents', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'someKey',
          entityType: 'agents',
          entityName: 'my-agent',
        });

        expect(result).toBeSuccessful();
        // Verify generatedPaths format: [specific, type, global]
        expect(result).toHaveTextContent('"generatedPaths":["agents.my_agent.someKey","agents.someKey","someKey"]');
      });

      test('should generate correct env keys for complex entity names', async ({ mcp }) => {
        const result = await mcp.tools.call('test-config-fallback', {
          key: 'myKey',
          entityType: 'plugins',
          entityName: 'my-awesome-plugin',
        });

        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('PLUGINS_MY_AWESOME_PLUGIN_MYKEY');
        expect(result).toHaveTextContent('PLUGINS_MYKEY');
        expect(result).toHaveTextContent('"MYKEY"');
      });
    });
  });
});
