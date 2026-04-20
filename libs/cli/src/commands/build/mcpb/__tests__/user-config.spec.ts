import { idToCamelKey, setupStepsToUserConfig } from '../user-config';

describe('idToCamelKey', () => {
  it('handles kebab case', () => {
    expect(idToCamelKey('api-token')).toBe('apiToken');
  });
  it('handles snake case', () => {
    expect(idToCamelKey('max_items')).toBe('maxItems');
  });
  it('handles SCREAMING_SNAKE', () => {
    expect(idToCamelKey('REDIS_URL')).toBe('redisUrl');
  });
  it('falls back to "value" when input is empty', () => {
    expect(idToCamelKey('')).toBe('value');
  });
});

describe('setupStepsToUserConfig', () => {
  it('returns empty when no steps and no deployment override', () => {
    const result = setupStepsToUserConfig(undefined);
    expect(result.userConfig).toEqual({});
    expect(result.env).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it('translates string step to user_config string entry', () => {
    const result = setupStepsToUserConfig([
      {
        id: 'api-token',
        prompt: 'API Token',
        description: 'Token for API access',
        jsonSchema: { type: 'string' },
        sensitive: true,
      },
    ]);
    expect(result.userConfig.apiToken).toEqual({
      type: 'string',
      title: 'API Token',
      description: 'Token for API access',
      sensitive: true,
      required: true,
    });
    expect(result.env).toEqual({ API_TOKEN: '${user_config.apiToken}' });
  });

  it('maps number schemas with bounds', () => {
    const result = setupStepsToUserConfig([
      {
        id: 'max-items',
        prompt: 'Max Items',
        jsonSchema: { type: 'number', minimum: 1, maximum: 100, default: 10 },
      },
    ]);
    expect(result.userConfig.maxItems).toMatchObject({
      type: 'number',
      min: 1,
      max: 100,
      default: 10,
    });
  });

  it('maps boolean schemas', () => {
    const result = setupStepsToUserConfig([
      { id: 'enabled', prompt: 'Enabled?', jsonSchema: { type: 'boolean', default: true } },
    ]);
    expect(result.userConfig.enabled.type).toBe('boolean');
    expect(result.userConfig.enabled.default).toBe(true);
  });

  it('sets multiple:true for array schemas', () => {
    const result = setupStepsToUserConfig([
      {
        id: 'paths',
        prompt: 'Paths',
        jsonSchema: { type: 'array', items: { type: 'string' } },
      },
    ]);
    expect(result.userConfig.paths.type).toBe('string');
    expect(result.userConfig.paths.multiple).toBe(true);
  });

  it('emits warning for showWhen/next branching', () => {
    const result = setupStepsToUserConfig([
      { id: 'a', prompt: 'A', jsonSchema: { type: 'string' }, next: 'b' },
      { id: 'b', prompt: 'B', jsonSchema: { type: 'string' }, showWhen: { a: 'yes' } },
    ]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('drops default when sensitive', () => {
    const result = setupStepsToUserConfig([
      {
        id: 'secret',
        prompt: 'Secret',
        jsonSchema: { type: 'string', default: 'do-not-commit' },
        sensitive: true,
      },
    ]);
    expect(result.userConfig.secret.default).toBeUndefined();
  });

  it('honors deployment.userConfig.type overrides (e.g., directory)', () => {
    const result = setupStepsToUserConfig(
      [{ id: 'workspace', prompt: 'Workspace', jsonSchema: { type: 'string' } }],
      {
        target: 'mcpb',
        userConfig: {
          workspace: { type: 'directory', title: 'Workspace dir' },
        },
      },
    );
    expect(result.userConfig.workspace.type).toBe('directory');
  });

  it('merges deployment-only user_config entries not backed by a step', () => {
    const result = setupStepsToUserConfig(undefined, {
      target: 'mcpb',
      userConfig: {
        extra: { type: 'boolean', title: 'Extra' },
      },
    });
    expect(result.userConfig.extra.title).toBe('Extra');
  });

  it('uses step.env for env key when provided', () => {
    const result = setupStepsToUserConfig([
      {
        id: 'api-token',
        env: 'MY_TOKEN',
        prompt: 'Token',
        jsonSchema: { type: 'string' },
      },
    ]);
    expect(Object.keys(result.env)).toEqual(['MY_TOKEN']);
    expect(result.env.MY_TOKEN).toBe('${user_config.apiToken}');
  });
});
