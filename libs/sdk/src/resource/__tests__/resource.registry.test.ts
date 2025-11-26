import 'reflect-metadata';
import ResourceRegistry from '../resource.registry';
import { Resource, ResourceTemplate } from '../../common/decorators/resource.decorator';

// Mock the complex dependencies
const createMockHookRegistry = () => ({
  registerHooks: jest.fn().mockResolvedValue(undefined),
});

const createMockScope = () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  providers: {
    getHooksRegistry: jest.fn().mockReturnValue(createMockHookRegistry()),
  },
  registryFlows: jest.fn().mockResolvedValue(undefined),
});

const createMockProviderRegistry = () => {
  const mockScope = createMockScope();

  return {
    getActiveScope: jest.fn().mockReturnValue(mockScope),
    get: jest.fn().mockReturnValue(undefined),
    getRegistries: jest.fn().mockReturnValue([]),
    addRegistry: jest.fn(),
  } as any;
};

const createMockOwner = () => ({
  kind: 'app' as const,
  id: 'test-app',
  ref: {} as any,
});

describe('ResourceRegistry', () => {
  describe('Registration', () => {
    it('should register class-based static resource', async () => {
      @Resource({
        name: 'static-resource',
        uri: 'static://uri',
      })
      class StaticResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [StaticResource], createMockOwner());
      await registry.ready;

      const resources = registry.getResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].name).toBe('static-resource');
    });

    it('should register class-based template resource', async () => {
      @ResourceTemplate({
        name: 'template-resource',
        uriTemplate: 'template://{id}',
      })
      class TemplateResource {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [TemplateResource], createMockOwner());
      await registry.ready;

      const templates = registry.getResourceTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('template-resource');
    });

    it('should handle empty resource list', async () => {
      const registry = new ResourceRegistry(createMockProviderRegistry(), [], createMockOwner());
      await registry.ready;

      expect(registry.getResources()).toHaveLength(0);
      expect(registry.getResourceTemplates()).toHaveLength(0);
    });

    it('should register multiple resources', async () => {
      @Resource({ name: 'res1', uri: 'res1://uri' })
      class Res1 {
        execute() {
          return { text: '1' };
        }
      }

      @Resource({ name: 'res2', uri: 'res2://uri' })
      class Res2 {
        execute() {
          return { text: '2' };
        }
      }

      @ResourceTemplate({ name: 'tmpl1', uriTemplate: 'tmpl1://{id}' })
      class Tmpl1 {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't1' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Res1, Res2, Tmpl1], createMockOwner());
      await registry.ready;

      expect(registry.getResources()).toHaveLength(2);
      expect(registry.getResourceTemplates()).toHaveLength(1);
    });
  });

  describe('getResources', () => {
    it('should return all static resources', async () => {
      @Resource({ name: 'static1', uri: 'static1://uri' })
      class Static1 {
        execute() {
          return { text: 's1' };
        }
      }

      @Resource({ name: 'static2', uri: 'static2://uri' })
      class Static2 {
        execute() {
          return { text: 's2' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Static1, Static2], createMockOwner());
      await registry.ready;

      const resources = registry.getResources();
      expect(resources).toHaveLength(2);
      expect(resources.map((r) => r.name).sort()).toEqual(['static1', 'static2']);
    });

    it('should exclude templates', async () => {
      @Resource({ name: 'static', uri: 'static://uri' })
      class Static {
        execute() {
          return { text: 's' };
        }
      }

      @ResourceTemplate({ name: 'template', uriTemplate: 'template://{id}' })
      class Template {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Static, Template], createMockOwner());
      await registry.ready;

      const resources = registry.getResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].name).toBe('static');
    });
  });

  describe('getResourceTemplates', () => {
    it('should return all template resources', async () => {
      @ResourceTemplate({ name: 'tmpl1', uriTemplate: 'tmpl1://{id}' })
      class Tmpl1 {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't1' };
        }
      }

      @ResourceTemplate({ name: 'tmpl2', uriTemplate: 'tmpl2://{id}' })
      class Tmpl2 {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't2' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Tmpl1, Tmpl2], createMockOwner());
      await registry.ready;

      const templates = registry.getResourceTemplates();
      expect(templates).toHaveLength(2);
    });

    it('should exclude static resources', async () => {
      @Resource({ name: 'static', uri: 'static://uri' })
      class Static {
        execute() {
          return { text: 's' };
        }
      }

      @ResourceTemplate({ name: 'template', uriTemplate: 'template://{id}' })
      class Template {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Static, Template], createMockOwner());
      await registry.ready;

      const templates = registry.getResourceTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('template');
    });
  });

  describe('findByUri', () => {
    it('should find resource by exact URI', async () => {
      @Resource({ name: 'findable', uri: 'findable://exact' })
      class Findable {
        execute() {
          return { text: 'found' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Findable], createMockOwner());
      await registry.ready;

      const found = registry.findByUri('findable://exact');
      expect(found).toBeDefined();
      expect(found?.name).toBe('findable');
    });

    it('should return undefined for unknown URI', async () => {
      @Resource({ name: 'existing', uri: 'existing://uri' })
      class Existing {
        execute() {
          return { text: 'e' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Existing], createMockOwner());
      await registry.ready;

      const notFound = registry.findByUri('unknown://uri');
      expect(notFound).toBeUndefined();
    });
  });

  describe('matchTemplateByUri', () => {
    it('should match template and extract params', async () => {
      @ResourceTemplate({ name: 'user', uriTemplate: 'users://{userId}' })
      class User {
        execute(uri: string, params: Record<string, string>) {
          return { text: `user ${params.userId}` };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [User], createMockOwner());
      await registry.ready;

      const result = registry.matchTemplateByUri('users://123');
      expect(result).toBeDefined();
      expect(result?.params).toEqual({ userId: '123' });
      expect(result?.instance.name).toBe('user');
    });

    it('should return undefined for non-matching URI', async () => {
      @ResourceTemplate({ name: 'user', uriTemplate: 'users://{userId}' })
      class User {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'user' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [User], createMockOwner());
      await registry.ready;

      const result = registry.matchTemplateByUri('posts://123');
      expect(result).toBeUndefined();
    });
  });

  describe('findResourceForUri', () => {
    it('should find static resource first', async () => {
      @Resource({ name: 'exact', uri: 'exact://match' })
      class Exact {
        execute() {
          return { text: 'exact' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Exact], createMockOwner());
      await registry.ready;

      const result = registry.findResourceForUri('exact://match');
      expect(result).toBeDefined();
      expect(result?.instance.name).toBe('exact');
      expect(result?.params).toEqual({});
    });

    it('should fallback to template matching', async () => {
      @ResourceTemplate({ name: 'dynamic', uriTemplate: 'dynamic://{id}' })
      class Dynamic {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'dynamic' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Dynamic], createMockOwner());
      await registry.ready;

      const result = registry.findResourceForUri('dynamic://abc');
      expect(result).toBeDefined();
      expect(result?.instance.name).toBe('dynamic');
      expect(result?.params).toEqual({ id: 'abc' });
    });

    it('should return undefined if no match', async () => {
      @Resource({ name: 'only', uri: 'only://uri' })
      class Only {
        execute() {
          return { text: 'only' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Only], createMockOwner());
      await registry.ready;

      const result = registry.findResourceForUri('different://uri');
      expect(result).toBeUndefined();
    });

    it('should prefer static over template match', async () => {
      @Resource({ name: 'static', uri: 'items://123' })
      class StaticItem {
        execute() {
          return { text: 'static' };
        }
      }

      @ResourceTemplate({ name: 'dynamic', uriTemplate: 'items://{id}' })
      class DynamicItem {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'dynamic' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [StaticItem, DynamicItem], createMockOwner());
      await registry.ready;

      const result = registry.findResourceForUri('items://123');
      expect(result).toBeDefined();
      expect(result?.instance.name).toBe('static');
      expect(result?.params).toEqual({});
    });
  });

  describe('listAllIndexed', () => {
    it('should return all indexed resources', async () => {
      @Resource({ name: 'res1', uri: 'res1://uri' })
      class Res1 {
        execute() {
          return { text: '1' };
        }
      }

      @ResourceTemplate({ name: 'tmpl1', uriTemplate: 'tmpl1://{id}' })
      class Tmpl1 {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't1' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Res1, Tmpl1], createMockOwner());
      await registry.ready;

      const indexed = registry.listAllIndexed();
      expect(indexed).toHaveLength(2);
    });

    it('should include both static and templates', async () => {
      @Resource({ name: 'static', uri: 'static://uri' })
      class Static {
        execute() {
          return { text: 's' };
        }
      }

      @ResourceTemplate({ name: 'template', uriTemplate: 'template://{id}' })
      class Template {
        execute(uri: string, params: Record<string, string>) {
          return { text: 't' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Static, Template], createMockOwner());
      await registry.ready;

      const indexed = registry.listAllIndexed();
      const names = indexed.map((r) => r.baseName).sort();
      expect(names).toEqual(['static', 'template']);

      const staticRow = indexed.find((r) => !r.isTemplate);
      const templateRow = indexed.find((r) => r.isTemplate);
      expect(staticRow).toBeDefined();
      expect(templateRow).toBeDefined();
    });
  });

  describe('exportResolvedNames', () => {
    it('should export with default snake_case', async () => {
      @Resource({ name: 'myResource', uri: 'my://resource' })
      class MyResource {
        execute() {
          return { text: 'content' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [MyResource], createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames();
      expect(exported).toHaveLength(1);
      expect(exported[0].name).toBe('my_resource');
    });

    it('should export with kebab-case', async () => {
      @Resource({ name: 'myResource', uri: 'my://resource' })
      class MyResource {
        execute() {
          return { text: 'content' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [MyResource], createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames({ case: 'kebab' });
      expect(exported).toHaveLength(1);
      expect(exported[0].name).toBe('my-resource');
    });

    it('should handle multiple resources with unique names', async () => {
      @Resource({ name: 'first', uri: 'first://uri' })
      class First {
        execute() {
          return { text: '1' };
        }
      }

      @Resource({ name: 'second', uri: 'second://uri' })
      class Second {
        execute() {
          return { text: '2' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [First, Second], createMockOwner());
      await registry.ready;

      const exported = registry.exportResolvedNames();
      expect(exported).toHaveLength(2);
      const names = exported.map((e) => e.name).sort();
      expect(names).toEqual(['first', 'second']);
    });
  });

  describe('hasAny', () => {
    it('should return true when registry has resources', async () => {
      @Resource({ name: 'test', uri: 'test://uri' })
      class Test {
        execute() {
          return { text: 'test' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Test], createMockOwner());
      await registry.ready;

      expect(registry.hasAny()).toBe(true);
    });

    it('should return false when registry is empty', async () => {
      const registry = new ResourceRegistry(createMockProviderRegistry(), [], createMockOwner());
      await registry.ready;

      expect(registry.hasAny()).toBe(false);
    });
  });

  describe('getInlineResources', () => {
    it('should return locally registered resources', async () => {
      @Resource({ name: 'inline', uri: 'inline://uri' })
      class Inline {
        execute() {
          return { text: 'inline' };
        }
      }

      const registry = new ResourceRegistry(createMockProviderRegistry(), [Inline], createMockOwner());
      await registry.ready;

      const inline = registry.getInlineResources();
      expect(inline).toHaveLength(1);
      expect(inline[0].name).toBe('inline');
    });
  });
});
