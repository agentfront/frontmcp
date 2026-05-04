import type { Token } from '@frontmcp/di';
import type { ProviderRegistry, ToolFunctionTokenRecord, ToolRegistry } from '@frontmcp/sdk';

import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import { OperationToolFactory, operationToolName } from '../tools/operation-tool.factory';

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
  registered: { token: Token; metadataName: string; visibility: unknown }[] = [];
  unregistered: Token[] = [];

  registerToolInstance(tool: { record: ToolFunctionTokenRecord }) {
    const token = tool.record.provide as unknown as Token;
    this.registered.push({
      token,
      metadataName: tool.record.metadata.name,
      visibility: (tool.record.metadata as { visibility?: unknown }).visibility,
    });
  }
  unregisterToolInstance(token: Token): boolean {
    this.unregistered.push(token);
    return true;
  }
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
  });
});
