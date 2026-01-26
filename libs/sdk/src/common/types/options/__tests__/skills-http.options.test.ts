// common/types/options/__tests__/skills-http.options.test.ts

import {
  skillsConfigOptionsSchema,
  skillsConfigEndpointConfigSchema,
  skillsConfigAuthModeSchema,
  normalizeEndpointConfig,
  normalizeSkillsConfigOptions,
} from '../skills-http';

describe('skillsConfigAuthModeSchema', () => {
  it('should accept valid auth modes', () => {
    const validModes = ['inherit', 'public', 'api-key', 'bearer'];
    for (const mode of validModes) {
      const result = skillsConfigAuthModeSchema.safeParse(mode);
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid auth modes', () => {
    const result = skillsConfigAuthModeSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });
});

describe('skillsConfigEndpointConfigSchema', () => {
  describe('default values', () => {
    it('should apply default enabled=true', () => {
      const result = skillsConfigEndpointConfigSchema.parse({});
      expect(result.enabled).toBe(true);
    });
  });

  describe('validation', () => {
    it('should accept config with enabled and path', () => {
      const result = skillsConfigEndpointConfigSchema.safeParse({
        enabled: true,
        path: '/custom/path',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.path).toBe('/custom/path');
      }
    });

    it('should accept disabled endpoint', () => {
      const result = skillsConfigEndpointConfigSchema.safeParse({
        enabled: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(false);
      }
    });

    it('should accept path only', () => {
      const result = skillsConfigEndpointConfigSchema.safeParse({
        path: '/custom.txt',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.path).toBe('/custom.txt');
        expect(result.data.enabled).toBe(true);
      }
    });
  });
});

describe('skillsConfigOptionsSchema', () => {
  describe('default values', () => {
    it('should apply default enabled=false', () => {
      const result = skillsConfigOptionsSchema.parse({});
      expect(result.enabled).toBe(false);
    });

    it('should apply default auth=inherit', () => {
      const result = skillsConfigOptionsSchema.parse({});
      expect(result.auth).toBe('inherit');
    });

    it('should apply default mcpTools=true', () => {
      const result = skillsConfigOptionsSchema.parse({});
      expect(result.mcpTools).toBe(true);
    });

    it('should apply default llmTxt=true', () => {
      const result = skillsConfigOptionsSchema.parse({});
      expect(result.llmTxt).toBe(true);
    });

    it('should apply default llmFullTxt=true', () => {
      const result = skillsConfigOptionsSchema.parse({});
      expect(result.llmFullTxt).toBe(true);
    });

    it('should apply default api=true', () => {
      const result = skillsConfigOptionsSchema.parse({});
      expect(result.api).toBe(true);
    });
  });

  describe('validation', () => {
    it('should accept enabled configuration with top-level auth', () => {
      const result = skillsConfigOptionsSchema.safeParse({
        enabled: true,
        prefix: '/api',
        auth: 'api-key',
        apiKeys: ['sk-123'],
        mcpTools: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.enabled).toBe(true);
        expect(result.data.prefix).toBe('/api');
        expect(result.data.auth).toBe('api-key');
        expect(result.data.apiKeys).toEqual(['sk-123']);
        expect(result.data.mcpTools).toBe(false);
      }
    });

    it('should accept endpoint boolean shorthand', () => {
      const result = skillsConfigOptionsSchema.safeParse({
        llmTxt: false,
        llmFullTxt: true,
        api: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.llmTxt).toBe(false);
        expect(result.data.llmFullTxt).toBe(true);
        expect(result.data.api).toBe(false);
      }
    });

    it('should accept endpoint config objects with path only', () => {
      const result = skillsConfigOptionsSchema.safeParse({
        llmTxt: { path: '/custom/llm.txt' },
        api: { enabled: false },
      });
      expect(result.success).toBe(true);
    });

    it('should accept complete configuration', () => {
      const result = skillsConfigOptionsSchema.safeParse({
        enabled: true,
        prefix: '/v1',
        auth: 'public',
        llmTxt: { enabled: true, path: '/custom-llm.txt' },
        llmFullTxt: { enabled: false },
        api: { enabled: true },
        mcpTools: false,
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty apiKeys strings', () => {
      const result = skillsConfigOptionsSchema.safeParse({
        auth: 'api-key',
        apiKeys: [''],
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('normalizeEndpointConfig', () => {
  it('should normalize undefined to enabled config with parent auth', () => {
    const result = normalizeEndpointConfig(undefined, '/default.txt', 'public', ['key1']);
    expect(result).toEqual({
      enabled: true,
      path: '/default.txt',
      auth: 'public',
      apiKeys: ['key1'],
    });
  });

  it('should normalize true to enabled config with parent auth', () => {
    const result = normalizeEndpointConfig(true, '/default.txt', 'api-key', ['sk-123']);
    expect(result).toEqual({
      enabled: true,
      path: '/default.txt',
      auth: 'api-key',
      apiKeys: ['sk-123'],
    });
  });

  it('should normalize false to disabled config with parent auth', () => {
    const result = normalizeEndpointConfig(false, '/default.txt', 'bearer');
    expect(result).toEqual({
      enabled: false,
      path: '/default.txt',
      auth: 'bearer',
      apiKeys: undefined,
    });
  });

  it('should normalize config object with custom path and parent auth', () => {
    const result = normalizeEndpointConfig({ enabled: true, path: '/custom.txt' }, '/default.txt', 'api-key', [
      'sk-123',
    ]);
    expect(result).toEqual({
      enabled: true,
      path: '/custom.txt',
      auth: 'api-key',
      apiKeys: ['sk-123'],
    });
  });

  it('should use default path when config object has no path', () => {
    const result = normalizeEndpointConfig({ enabled: true }, '/default.txt', 'inherit');
    expect(result.path).toBe('/default.txt');
  });

  it('should always use parent auth regardless of endpoint config', () => {
    const result = normalizeEndpointConfig({ path: '/custom.txt' }, '/default.txt', 'bearer');
    expect(result.auth).toBe('bearer');
  });
});

describe('normalizeSkillsConfigOptions', () => {
  it('should normalize undefined to default config', () => {
    const result = normalizeSkillsConfigOptions(undefined);
    expect(result.enabled).toBe(false);
    expect(result.auth).toBe('inherit');
    expect(result.mcpTools).toBe(true);
    expect(result.normalizedLlmTxt.enabled).toBe(true);
    expect(result.normalizedLlmTxt.path).toBe('/llm.txt');
    expect(result.normalizedLlmTxt.auth).toBe('inherit');
    expect(result.normalizedLlmFullTxt.enabled).toBe(true);
    expect(result.normalizedLlmFullTxt.path).toBe('/llm_full.txt');
    expect(result.normalizedLlmFullTxt.auth).toBe('inherit');
    expect(result.normalizedApi.enabled).toBe(true);
    expect(result.normalizedApi.path).toBe('/skills');
    expect(result.normalizedApi.auth).toBe('inherit');
  });

  it('should apply top-level auth to all endpoints', () => {
    const result = normalizeSkillsConfigOptions({
      enabled: true,
      auth: 'api-key',
      apiKeys: ['sk-test'],
    });
    expect(result.normalizedLlmTxt.auth).toBe('api-key');
    expect(result.normalizedLlmTxt.apiKeys).toEqual(['sk-test']);
    expect(result.normalizedLlmFullTxt.auth).toBe('api-key');
    expect(result.normalizedLlmFullTxt.apiKeys).toEqual(['sk-test']);
    expect(result.normalizedApi.auth).toBe('api-key');
    expect(result.normalizedApi.apiKeys).toEqual(['sk-test']);
  });

  it('should apply prefix to all endpoint paths', () => {
    const result = normalizeSkillsConfigOptions({ enabled: true, prefix: '/api' });
    expect(result.normalizedLlmTxt.path).toBe('/api/llm.txt');
    expect(result.normalizedLlmFullTxt.path).toBe('/api/llm_full.txt');
    expect(result.normalizedApi.path).toBe('/api/skills');
  });

  it('should preserve custom endpoint paths over prefix', () => {
    const result = normalizeSkillsConfigOptions({
      enabled: true,
      prefix: '/api',
      llmTxt: { path: '/custom/llm.txt' },
    });
    expect(result.normalizedLlmTxt.path).toBe('/custom/llm.txt');
    expect(result.normalizedLlmFullTxt.path).toBe('/api/llm_full.txt');
  });

  it('should handle mcpTools=false', () => {
    const result = normalizeSkillsConfigOptions({ mcpTools: false });
    expect(result.mcpTools).toBe(false);
  });

  it('should handle disabled endpoints', () => {
    const result = normalizeSkillsConfigOptions({
      llmTxt: false,
      llmFullTxt: false,
      api: false,
    });
    expect(result.normalizedLlmTxt.enabled).toBe(false);
    expect(result.normalizedLlmFullTxt.enabled).toBe(false);
    expect(result.normalizedApi.enabled).toBe(false);
  });

  it('should use public auth for all endpoints when configured', () => {
    const result = normalizeSkillsConfigOptions({
      enabled: true,
      auth: 'public',
    });
    expect(result.normalizedLlmTxt.auth).toBe('public');
    expect(result.normalizedLlmFullTxt.auth).toBe('public');
    expect(result.normalizedApi.auth).toBe('public');
  });
});
