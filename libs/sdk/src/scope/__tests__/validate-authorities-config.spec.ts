import 'reflect-metadata';
import { Scope } from '../scope.instance';

/**
 * Unit tests for Scope.validateAuthoritiesConfig().
 *
 * This private method enforces a fail-fast check: if any registered entry
 * (tool, resource, prompt) declares 'authorities' metadata but no
 * AuthoritiesEngine is configured on the scope, initialization must throw
 * with a clear error message. This prevents a silent security bypass where
 * a tool appears protected but is actually accessible to all users.
 */

// Extract the private method for direct testing
const validateAuthoritiesConfig = (Scope.prototype as unknown as Record<string, unknown>)[
  'validateAuthoritiesConfig'
] as () => void;

interface MockEntry {
  name: string;
  metadata: Record<string, unknown>;
}

interface MockScope {
  _authoritiesEngine: unknown;
  scopeTools: { getTools(includeHidden: boolean): MockEntry[] };
  scopeResources: { getResources(): MockEntry[] };
  scopePrompts: { getPrompts(): MockEntry[] };
}

function createMockScope(overrides: Partial<MockScope> = {}): MockScope {
  return {
    _authoritiesEngine: undefined,
    scopeTools: { getTools: () => [] },
    scopeResources: { getResources: () => [] },
    scopePrompts: { getPrompts: () => [] },
    ...overrides,
  };
}

describe('validateAuthoritiesConfig', () => {
  it('should not throw when no entries have authorities and no engine is configured', () => {
    const scope = createMockScope();
    expect(() => validateAuthoritiesConfig.call(scope)).not.toThrow();
  });

  it('should not throw when engine is configured even if entries have authorities', () => {
    const scope = createMockScope({
      _authoritiesEngine: { evaluate: jest.fn() }, // truthy engine
      scopeTools: {
        getTools: () => [{ name: 'admin-tool', metadata: { name: 'admin-tool', authorities: 'admin' } }],
      },
    });
    expect(() => validateAuthoritiesConfig.call(scope)).not.toThrow();
  });

  it('should throw when a tool has authorities but no engine is configured', () => {
    const scope = createMockScope({
      scopeTools: {
        getTools: () => [
          {
            name: 'admin-tool',
            metadata: { name: 'admin-tool', authorities: { roles: { any: ['admin'] } } },
          },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(
      /Authorities configuration required.*Tool "admin-tool".*but no authorities engine is configured/,
    );
  });

  it('should throw when a resource has authorities but no engine is configured', () => {
    const scope = createMockScope({
      scopeResources: {
        getResources: () => [
          {
            name: 'secret-resource',
            metadata: { name: 'secret-resource', authorities: 'admin' },
          },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(
      /Authorities configuration required.*Resource "secret-resource".*but no authorities engine is configured/,
    );
  });

  it('should throw when a prompt has authorities but no engine is configured', () => {
    const scope = createMockScope({
      scopePrompts: {
        getPrompts: () => [
          {
            name: 'protected-prompt',
            metadata: { name: 'protected-prompt', authorities: ['authenticated'] },
          },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(
      /Authorities configuration required.*Prompt "protected-prompt".*but no authorities engine is configured/,
    );
  });

  it('should list multiple entries in the error message', () => {
    const scope = createMockScope({
      scopeTools: {
        getTools: () => [
          { name: 'tool-a', metadata: { name: 'tool-a', authorities: 'admin' } },
          { name: 'tool-b', metadata: { name: 'tool-b', authorities: 'editor' } },
        ],
      },
      scopeResources: {
        getResources: () => [
          { name: 'res-a', metadata: { name: 'res-a', authorities: 'admin' } },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(
      /Tool "tool-a".*Tool "tool-b".*Resource "res-a"/,
    );
  });

  it('should truncate to first 5 entries and show overflow count', () => {
    const tools = Array.from({ length: 7 }, (_, i) => ({
      name: `tool-${i}`,
      metadata: { name: `tool-${i}`, authorities: 'admin' },
    }));

    const scope = createMockScope({
      scopeTools: { getTools: () => tools },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(/and 2 more/);
  });

  it('should not truncate when exactly 5 entries have authorities', () => {
    const tools = Array.from({ length: 5 }, (_, i) => ({
      name: `tool-${i}`,
      metadata: { name: `tool-${i}`, authorities: 'admin' },
    }));

    const scope = createMockScope({
      scopeTools: { getTools: () => tools },
    });

    try {
      validateAuthoritiesConfig.call(scope);
      fail('Expected an error to be thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Tool "tool-0"');
      expect(message).toContain('Tool "tool-4"');
      expect(message).not.toContain('more');
    }
  });

  it('should pass getTools(true) to include hidden tools in the check', () => {
    const getToolsSpy = jest.fn().mockReturnValue([
      { name: 'hidden-admin', metadata: { name: 'hidden-admin', authorities: 'admin' } },
    ]);

    const scope = createMockScope({
      scopeTools: { getTools: getToolsSpy },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(/Tool "hidden-admin"/);
    expect(getToolsSpy).toHaveBeenCalledWith(true);
  });

  it('should ignore entries without authorities metadata', () => {
    const scope = createMockScope({
      scopeTools: {
        getTools: () => [
          { name: 'public-tool', metadata: { name: 'public-tool' } },
          { name: 'another-tool', metadata: { name: 'another-tool', description: 'no auth' } },
        ],
      },
      scopeResources: {
        getResources: () => [
          { name: 'open-resource', metadata: { name: 'open-resource' } },
        ],
      },
      scopePrompts: {
        getPrompts: () => [
          { name: 'open-prompt', metadata: { name: 'open-prompt' } },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).not.toThrow();
  });

  it('should include suggestion to add authorities config in error message', () => {
    const scope = createMockScope({
      scopeTools: {
        getTools: () => [
          { name: 'my-tool', metadata: { name: 'my-tool', authorities: 'admin' } },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(
      /Add 'authorities: \{ claimsMapping: \{...\}, profiles: \{...\} \}'/,
    );
  });

  it('should include suggestion to remove authorities in error message', () => {
    const scope = createMockScope({
      scopeTools: {
        getTools: () => [
          { name: 'my-tool', metadata: { name: 'my-tool', authorities: 'admin' } },
        ],
      },
    });

    expect(() => validateAuthoritiesConfig.call(scope)).toThrow(
      /or remove 'authorities' from entry metadata/,
    );
  });
});
