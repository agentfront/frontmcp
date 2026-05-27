import type { Token } from '@frontmcp/di';
import type { ProviderRegistry, ToolFunctionTokenRecord, ToolRegistry } from '@frontmcp/sdk';

import { executeOperation } from '../executor/openapi-runtime';
import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { OperationToolFactory, operationToolName } from '../tools/operation-tool.factory';

jest.mock('../executor/openapi-runtime', () => ({
  executeOperation: jest.fn(async () => ({
    ok: true,
    status: 200,
    data: { ok: true },
    contentType: 'application/json',
  })),
}));

const mockExecuteOperation = executeOperation as jest.MockedFunction<typeof executeOperation>;

const noopLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

class FakeProviderRegistry {
  // ToolInstance reads `getActiveScope()` during construction; return a stub
  // with the shape the constructor touches.
  getActiveScope() {
    return {
      logger: noopLogger,
      hooks: { registerHooks: jest.fn() },
    };
  }
}

class FakeToolRegistry {
  registered: { token: Token; executor: unknown; metadataName: string; visibility: unknown }[] = [];
  unregistered: Token[] = [];

  registerToolInstance(tool: { record: ToolFunctionTokenRecord }) {
    const token = tool.record.provide as unknown as Token;
    this.registered.push({
      token,
      executor: tool.record.provide,
      metadataName: tool.record.metadata.name,
      visibility: (tool.record.metadata as { visibility?: unknown }).visibility,
    });
  }
  unregisterToolInstance(token: Token): boolean {
    this.unregistered.push(token);
    return true;
  }
}

function buildFakeCtx(overrides: { granted?: boolean; deniedBy?: string } = {}) {
  const guard = {
    check: jest.fn(async () => ({ granted: overrides.granted ?? true, deniedBy: overrides.deniedBy })),
  };
  const resolver = {
    resolve: jest.fn(async () => 'token'),
  };
  const config = {
    outbound: {
      allowPrivateNetworks: false,
      maxConcurrencyPerHost: 10,
      defaultTimeoutMs: 30_000,
      defaultMaxResponseBytes: 256 * 1024,
      allowHttp: false,
    },
  };
  return {
    logger: noopLogger,
    authInfo: {},
    get: jest.fn((token: unknown) => {
      if (token === SkilledOpenApiConfig) return config;
      if (token === AuthorityGuard) return guard;
      if (token === SkilledOpenApiCredentialResolver) return resolver;
      return undefined;
    }),
  } as never;
}

const buildEntry = (overrides: Partial<HiddenOpEntry> = {}): HiddenOpEntry => ({
  skillId: 'invoices',
  bundleId: 'acme',
  bundleVersion: '1',
  service: { id: 'svc', baseUrl: 'https://example.com' },
  authBinding: { kind: 'none' },
  op: {
    operationId: 'createInvoice',
    serviceId: 'svc',
    httpMethod: 'POST',
    pathTemplate: '/v1/invoices',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    outputSchema: { type: 'object' },
    mapper: [],
    authBindingRef: 'def',
  },
  ...overrides,
});

describe('OperationToolFactory', () => {
  function makeFactory() {
    const toolRegistry = new FakeToolRegistry();
    const providers = new FakeProviderRegistry();
    const factory = new OperationToolFactory({
      toolRegistry: toolRegistry as unknown as ToolRegistry,
      providers: providers as unknown as ProviderRegistry,
      logger: noopLogger as never,
    });
    return { factory, toolRegistry };
  }

  describe('operationToolName', () => {
    it('namespaces by bundleId.operationId', () => {
      expect(operationToolName('acme', 'createInvoice')).toBe('acme.createInvoice');
    });

    it('falls back to bare operationId when namespaced form exceeds 64 chars', () => {
      const longBundle = 'a'.repeat(70);
      expect(operationToolName(longBundle, 'opX')).toBe('opX');
    });

    it('keeps namespaced form when total length is exactly 64', () => {
      const bundle = 'a'.repeat(60);
      expect(operationToolName(bundle, 'opX')).toBe(`${bundle}.opX`);
      expect(`${bundle}.opX`.length).toBe(64);
    });

    it('truncates the bare operationId when it itself exceeds 64 chars', () => {
      const bundle = 'short';
      const longOpId = 'op_' + 'x'.repeat(80);
      const out = operationToolName(bundle, longOpId);
      expect(out.length).toBe(64);
      expect(out).toBe(longOpId.slice(0, 64));
    });
  });

  describe('metadata derivation', () => {
    it('falls back to "<METHOD> <pathTemplate>" when summary is missing', () => {
      const { factory, toolRegistry } = makeFactory();
      const entry = buildEntry();
      delete (entry.op as { summary?: string }).summary;
      delete (entry.op as { description?: string }).description;
      factory.register(entry);
      // No way to read metadata back from the fake; assert via re-register
      // path that the registration succeeded with a valid name.
      expect(toolRegistry.registered).toHaveLength(1);
      expect(toolRegistry.registered[0].metadataName).toBe('acme.createInvoice');
    });
  });

  describe('register', () => {
    it('registers an internal tool with visibility=internal', () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());

      expect(toolRegistry.registered).toHaveLength(1);
      expect(toolRegistry.registered[0].metadataName).toBe('acme.createInvoice');
      expect(toolRegistry.registered[0].visibility).toBe('internal');
      expect(factory.size).toBe(1);
    });

    it('is idempotent for the same (bundleId, operationId)', () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      factory.register(buildEntry());

      expect(toolRegistry.registered).toHaveLength(1);
      expect(factory.size).toBe(1);
    });

    it('registers separate tools for different operations', () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry({ op: { ...buildEntry().op, operationId: 'a' } }));
      factory.register(buildEntry({ op: { ...buildEntry().op, operationId: 'b' } }));

      expect(toolRegistry.registered).toHaveLength(2);
      expect(toolRegistry.registered.map((r) => r.metadataName)).toEqual(['acme.a', 'acme.b']);
    });
  });

  describe('unregisterAll', () => {
    beforeEach(() => {
      noopLogger.warn.mockClear();
      noopLogger.info.mockClear();
      noopLogger.error.mockClear();
      noopLogger.debug.mockClear();
      noopLogger.verbose.mockClear();
      noopLogger.child.mockClear();
    });

    it('unregisters every tool the factory registered', () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry({ op: { ...buildEntry().op, operationId: 'a' } }));
      factory.register(buildEntry({ op: { ...buildEntry().op, operationId: 'b' } }));

      factory.unregisterAll();

      expect(toolRegistry.unregistered).toHaveLength(2);
      expect(factory.size).toBe(0);
    });

    it('after unregisterAll, the same op can be registered again', () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      factory.unregisterAll();
      factory.register(buildEntry());

      expect(toolRegistry.registered).toHaveLength(2);
      expect(factory.size).toBe(1);
    });

    describe('classification registry wiring', () => {
      function makeFactoryWithClassification() {
        const toolRegistry = new FakeToolRegistry();
        const providers = new FakeProviderRegistry();
        const classificationRegistry = {
          register: jest.fn(),
          unregister: jest.fn(),
        };
        const factory = new OperationToolFactory({
          toolRegistry: toolRegistry as unknown as ToolRegistry,
          providers: providers as unknown as ProviderRegistry,
          logger: noopLogger as never,
          classificationRegistry: classificationRegistry as unknown as Parameters<
            typeof OperationToolFactory
          >[0]['classificationRegistry'],
        });
        return { factory, toolRegistry, classificationRegistry };
      }

      it('records a classification when both registry + pathsWithGet are provided', () => {
        const { factory, classificationRegistry } = makeFactoryWithClassification();
        // pathsWithGet is empty because the bundle has no GET on /v1/invoices;
        // the classifier still produces a `tool` classification for POST,
        // with no emit (since neither self nor parent have a GET counterpart).
        const pathsWithGet = new Set<string>();
        factory.register(buildEntry(), { pathsWithGet });

        expect(classificationRegistry.register).toHaveBeenCalledTimes(1);
        const [toolName, classification] = classificationRegistry.register.mock.calls[0];
        expect(toolName).toBe('acme.createInvoice');
        expect(classification.specId).toBe('acme');
        expect(classification.method).toBe('POST');
        expect(classification.path).toBe('/v1/invoices');
        expect(classification.expose).toBe('tool');
      });

      it('emit is listChanged on self when POST collection has a matching GET in pathsWithGet', () => {
        const { factory, classificationRegistry } = makeFactoryWithClassification();
        // /v1/invoices has a GET in the bundle => POST is collection-create
        // => emit listChanged on self.
        const pathsWithGet = new Set(['/v1/invoices']);
        factory.register(buildEntry(), { pathsWithGet });

        const [, classification] = classificationRegistry.register.mock.calls[0];
        expect(classification.emit).toEqual({
          kind: 'listChanged',
          pathTemplate: '/v1/invoices',
          resourceUriTemplate: 'mcp+op://acme/v1/invoices',
        });
      });

      it('skips classification when pathsWithGet is omitted', () => {
        const { factory, classificationRegistry } = makeFactoryWithClassification();
        factory.register(buildEntry()); // no ctx
        expect(classificationRegistry.register).not.toHaveBeenCalled();
      });

      it('skips classification when the factory was constructed without a registry', () => {
        const { factory } = makeFactory();
        const pathsWithGet = new Set<string>();
        expect(() => factory.register(buildEntry(), { pathsWithGet })).not.toThrow();
      });

      it('unregisterAll also clears the classification entries it added', () => {
        const { factory, classificationRegistry } = makeFactoryWithClassification();
        const pathsWithGet = new Set<string>();
        factory.register(buildEntry({ op: { ...buildEntry().op, operationId: 'a' } }), { pathsWithGet });
        factory.register(buildEntry({ op: { ...buildEntry().op, operationId: 'b' } }), { pathsWithGet });

        expect(classificationRegistry.register).toHaveBeenCalledTimes(2);

        factory.unregisterAll();

        expect(classificationRegistry.unregister).toHaveBeenCalledTimes(2);
        expect(classificationRegistry.unregister).toHaveBeenCalledWith('acme.a');
        expect(classificationRegistry.unregister).toHaveBeenCalledWith('acme.b');
      });

      it('a classification failure is swallowed (warn-only) and does not block the tool registration', () => {
        const { factory, toolRegistry, classificationRegistry } = makeFactoryWithClassification();
        classificationRegistry.register.mockImplementationOnce(() => {
          throw new Error('boom');
        });

        // The tool registration must still succeed even if classification
        // throws — meta-tool surface stays available, only auto-notify is
        // skipped.
        expect(() => factory.register(buildEntry(), { pathsWithGet: new Set() })).not.toThrow();
        expect(toolRegistry.registered).toHaveLength(1);
        expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/classification failed/));
      });
    });

    it('logs but does not throw when the underlying registry rejects an unregister', () => {
      const toolRegistry = new FakeToolRegistry();
      const providers = new FakeProviderRegistry();
      jest.spyOn(toolRegistry, 'unregisterToolInstance').mockImplementation(() => {
        throw new Error('boom');
      });
      const factory = new OperationToolFactory({
        toolRegistry: toolRegistry as unknown as ToolRegistry,
        providers: providers as unknown as ProviderRegistry,
        logger: noopLogger as never,
      });
      factory.register(buildEntry());
      expect(() => factory.unregisterAll()).not.toThrow();
      expect(noopLogger.warn).toHaveBeenCalledWith(expect.stringMatching(/unregister failed/));
    });
  });

  describe('executor', () => {
    beforeEach(() => {
      mockExecuteOperation.mockClear();
      // noopLogger is shared across the suite. Without a per-test reset,
      // assertions like "warn was called" can be polluted by prior tests.
      noopLogger.warn.mockClear();
      noopLogger.info.mockClear();
      noopLogger.error.mockClear();
      noopLogger.debug.mockClear();
      noopLogger.verbose.mockClear();
      noopLogger.child.mockClear();
    });

    function lastExecutor(toolRegistry: FakeToolRegistry) {
      const last = toolRegistry.registered[toolRegistry.registered.length - 1];
      return last.executor as (
        input: Record<string, unknown>,
        ctx: never,
      ) => Promise<{
        ok: boolean;
        status: number;
        error?: string;
        data?: unknown;
        contentType?: string;
      }>;
    }

    it('returns an envelope with ok:false when authority denies the call', async () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec({ id: 'x' }, buildFakeCtx({ granted: false, deniedBy: 'role:admin' }));
      expect(result).toEqual({ ok: false, status: 0, error: expect.stringMatching(/authority denied/) });
      expect(mockExecuteOperation).not.toHaveBeenCalled();
    });

    it('returns an envelope with ok:false when input fails schema validation', async () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      // missing required `id`
      const result = await exec({}, buildFakeCtx());
      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/input validation failed/);
      expect(mockExecuteOperation).not.toHaveBeenCalled();
    });

    it('passes through executeOperation envelope on success', async () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec({ id: 'x' }, buildFakeCtx());
      expect(result).toEqual({ ok: true, status: 200, data: { ok: true }, contentType: 'application/json' });
      expect(mockExecuteOperation).toHaveBeenCalledTimes(1);
    });

    it('preserves error and contentType from upstream failure', async () => {
      mockExecuteOperation.mockResolvedValueOnce({ ok: false, status: 500, error: 'upstream-boom', data: undefined });
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec({ id: 'x' }, buildFakeCtx());
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe('upstream-boom');
    });

    it('omits data/contentType/error when upstream omits them', async () => {
      mockExecuteOperation.mockResolvedValueOnce({ ok: true, status: 204, data: undefined });
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec({ id: 'x' }, buildFakeCtx());
      expect(result).toEqual({ ok: true, status: 204 });
    });

    it('does not throw when service.baseUrl is malformed (allowedHosts stays empty)', async () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry({ service: { id: 'svc', baseUrl: 'not-a-url' } }));
      const exec = lastExecutor(toolRegistry);
      await expect(exec({ id: 'x' }, buildFakeCtx())).resolves.toMatchObject({ ok: true });
      expect(mockExecuteOperation).toHaveBeenCalledTimes(1);
    });

    it('treats undefined input as an empty object', async () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec(undefined as unknown as Record<string, unknown>, buildFakeCtx());
      // missing required `id`
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/input validation failed/);
    });
  });
});
