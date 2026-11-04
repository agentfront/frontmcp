import type { Token } from '@frontmcp/di';
import type { ProviderRegistry, ToolClassTokenRecord, ToolContext, ToolRegistry } from '@frontmcp/sdk';

import { executeOperation, type ExecutionResult } from '../executor/openapi-runtime';
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
  registered: { token: Token; record: ToolClassTokenRecord; metadataName: string; visibility: unknown }[] = [];
  unregistered: Token[] = [];

  registerToolInstance(tool: { record: ToolClassTokenRecord }) {
    const token = tool.record.provide as unknown as Token;
    this.registered.push({
      token,
      record: tool.record,
      metadataName: tool.record.metadata.name,
      visibility: (tool.record.metadata as { visibility?: unknown }).visibility,
    });
  }
  unregisterToolInstance(token: Token): boolean {
    this.unregistered.push(token);
    return true;
  }
}

/** The providers and call an operation tool is constructed with. */
interface FakeToolCall {
  providers: { get(token: unknown): unknown };
  authInfo: Record<string, unknown>;
  signal?: AbortSignal;
}

function buildFakeCtx(
  overrides: { granted?: boolean; deniedBy?: string; guard?: AuthorityGuard; signal?: AbortSignal } = {},
): FakeToolCall {
  const guard = overrides.guard ?? {
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
  const byToken = new Map<unknown, unknown>([
    [SkilledOpenApiConfig, config],
    [AuthorityGuard, guard],
    [SkilledOpenApiCredentialResolver, resolver],
  ]);
  return {
    authInfo: {},
    signal: overrides.signal,
    providers: { get: (token: unknown) => byToken.get(token) },
  };
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

    it('keeps a long name within 64 chars, unique per operation, and never the bare operationId', () => {
      const longBundle = 'a'.repeat(70);
      const name = operationToolName(longBundle, 'opX');

      expect(name.length).toBe(64);
      expect(name).not.toBe('opX');
      expect(name).toMatch(/^a+\.[0-9a-f]{16}$/);
      expect(operationToolName(longBundle, 'opY')).not.toBe(name);
      expect(operationToolName(longBundle, 'opX')).toBe(name);
    });

    it('keeps namespaced form when total length is exactly 64', () => {
      const bundle = 'a'.repeat(60);
      expect(operationToolName(bundle, 'opX')).toBe(`${bundle}.opX`);
      expect(`${bundle}.opX`.length).toBe(64);
    });

    it('gives two long operationIds that share their first 64 chars different names', () => {
      const shared = 'op_' + 'x'.repeat(80);

      expect(operationToolName('short', `${shared}A`)).not.toBe(operationToolName('short', `${shared}B`));
      expect(operationToolName('short', `${shared}A`).length).toBe(64);
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

    it('marks GET operations as read-only / non-destructive in the annotations', () => {
      const toolRegistry = new FakeToolRegistry();
      const providers = new FakeProviderRegistry();
      // Capture the metadata block by intercepting registerToolInstance.
      let captured: ToolClassTokenRecord['metadata'] | undefined;
      jest.spyOn(toolRegistry, 'registerToolInstance').mockImplementation((tool: { record: ToolClassTokenRecord }) => {
        captured = tool.record.metadata;
      });
      const factory = new OperationToolFactory({
        toolRegistry: toolRegistry as unknown as ToolRegistry,
        providers: providers as unknown as ProviderRegistry,
        logger: noopLogger as never,
      });
      const entry = buildEntry({
        op: { ...buildEntry().op, httpMethod: 'GET', summary: 'List invoices', description: 'Returns all invoices.' },
      });
      factory.register(entry);

      const annotations = captured?.annotations as {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        openWorldHint: boolean;
      };
      expect(annotations.readOnlyHint).toBe(true);
      expect(annotations.destructiveHint).toBe(false);
      // With both summary + description present, the description is the
      // composed "<summary>\n\n<description>" form.
      expect(captured?.description).toBe('List invoices\n\nReturns all invoices.');
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
          classificationRegistry: classificationRegistry as unknown as ConstructorParameters<
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

    /** Runs the last registered operation tool, as the call-tool flow does: its class built for the call, then executed. */
    function lastExecutor(toolRegistry: FakeToolRegistry) {
      const { record } = toolRegistry.registered[toolRegistry.registered.length - 1];
      return (input: Record<string, unknown>, call: FakeToolCall) => {
        const tool: ToolContext = new record.provide({ ...call, metadata: record.metadata, input, logger: noopLogger });
        return tool.execute(input) as Promise<{
          ok: boolean;
          status: number;
          error?: string;
          data?: unknown;
          contentType?: string;
        }>;
      };
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

    it("adds another skill's listing to the operation's tool, which admits a caller either skill admits", async () => {
      const { factory, toolRegistry } = makeFactory();
      const adminOnly = { roles: { any: ['admin'] } };
      factory.register(buildEntry({ skillId: 'billing-admin', skillRequiredAuthorities: adminOnly }));
      const adminListingOnly = lastExecutor(toolRegistry);
      const deniedBeforePublicListing = await adminListingOnly(
        { id: 'x' },
        buildFakeCtx({ guard: new AuthorityGuard() }),
      );
      factory.register(buildEntry({ skillId: 'invoices' }));

      expect(toolRegistry.registered).toHaveLength(1);
      expect(deniedBeforePublicListing).toEqual({
        ok: false,
        status: 0,
        error: expect.stringMatching(/authority denied/),
      });
      await expect(
        lastExecutor(toolRegistry)({ id: 'x' }, buildFakeCtx({ guard: new AuthorityGuard() })),
      ).resolves.toMatchObject({ ok: true });
    });

    it('passes through executeOperation envelope on success', async () => {
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec({ id: 'x' }, buildFakeCtx());
      expect(result).toEqual({ ok: true, status: 200, data: { ok: true }, contentType: 'application/json' });
      expect(mockExecuteOperation).toHaveBeenCalledTimes(1);
    });

    it("sends the request under the tool call's signal", async () => {
      const toolCall = new AbortController();
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());

      await lastExecutor(toolRegistry)({ id: 'x' }, buildFakeCtx({ signal: toolCall.signal }));

      expect(mockExecuteOperation).toHaveBeenCalledWith(expect.objectContaining({ signal: toolCall.signal }));
    });

    it('preserves error and contentType from upstream failure', async () => {
      mockExecuteOperation.mockResolvedValueOnce({
        ok: false,
        status: 500,
        error: 'upstream-boom',
        data: undefined,
      } as ExecutionResult);
      const { factory, toolRegistry } = makeFactory();
      factory.register(buildEntry());
      const exec = lastExecutor(toolRegistry);
      const result = await exec({ id: 'x' }, buildFakeCtx());
      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toBe('upstream-boom');
    });

    it('omits data/contentType/error when upstream omits them', async () => {
      mockExecuteOperation.mockResolvedValueOnce({ ok: true, status: 204, data: undefined } as ExecutionResult);
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
