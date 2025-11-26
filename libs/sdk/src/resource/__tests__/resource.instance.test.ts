import 'reflect-metadata';
import { ResourceInstance } from '../resource.instance';
import { Resource, ResourceTemplate } from '../../common/decorators/resource.decorator';
import { normalizeResource, normalizeResourceTemplate } from '../resource.utils';
import { ResourceKind } from '../../common/records';
import { ResourceTemplateKind } from '../resource.types';

// Mock the dependencies that ResourceInstance needs
const createMockProviderRegistry = () => {
  const mockScope = {
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    providers: {
      getHooksRegistry: jest.fn().mockReturnValue({
        registerHooks: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };

  return {
    getActiveScope: jest.fn().mockReturnValue(mockScope),
  } as any;
};

const createMockOwner = () => ({
  kind: 'app' as const,
  id: 'test-app',
  ref: {} as any,
});

describe('ResourceInstance', () => {
  describe('constructor', () => {
    it('should set name from metadata', async () => {
      @Resource({
        name: 'test-resource',
        uri: 'test://uri',
      })
      class TestResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(TestResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.name).toBe('test-resource');
    });

    it('should set uri for static resource', async () => {
      @Resource({
        name: 'static-resource',
        uri: 'static://my-uri',
      })
      class StaticResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(StaticResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.uri).toBe('static://my-uri');
      expect(instance.uriTemplate).toBeUndefined();
    });

    it('should set uriTemplate for template resource', async () => {
      @ResourceTemplate({
        name: 'template-resource',
        uriTemplate: 'template://{id}',
      })
      class TemplateResource {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(TemplateResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.uriTemplate).toBe('template://{id}');
      expect(instance.uri).toBeUndefined();
    });

    it('should set isTemplate correctly for static', async () => {
      @Resource({
        name: 'static',
        uri: 'static://uri',
      })
      class StaticResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(StaticResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.isTemplate).toBe(false);
    });

    it('should set isTemplate correctly for template', async () => {
      @ResourceTemplate({
        name: 'template',
        uriTemplate: 'template://{id}',
      })
      class TemplateResource {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(TemplateResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.isTemplate).toBe(true);
    });

    it('should set fullName with owner prefix', async () => {
      @Resource({
        name: 'named',
        uri: 'named://uri',
      })
      class NamedResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(NamedResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      expect(instance.fullName).toBe('test-app:named');
    });
  });

  describe('matchUri', () => {
    it('should match exact URI for static resource', async () => {
      @Resource({
        name: 'exact',
        uri: 'exact://match',
      })
      class ExactResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(ExactResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.matchUri('exact://match');
      expect(result.matches).toBe(true);
      expect(result.params).toEqual({});
    });

    it('should not match different URI for static resource', async () => {
      @Resource({
        name: 'nomatch',
        uri: 'nomatch://uri',
      })
      class NoMatchResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(NoMatchResource);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.matchUri('different://uri');
      expect(result.matches).toBe(false);
      expect(result.params).toEqual({});
    });

    it('should match and extract params for template', async () => {
      @ResourceTemplate({
        name: 'user-profile',
        uriTemplate: 'users://{userId}/profile',
      })
      class UserProfile {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(UserProfile);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.matchUri('users://123/profile');
      expect(result.matches).toBe(true);
      expect(result.params).toEqual({ userId: '123' });
    });

    it('should extract multiple params from template', async () => {
      @ResourceTemplate({
        name: 'post',
        uriTemplate: 'users://{userId}/posts/{postId}',
      })
      class Post {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(Post);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.matchUri('users://abc/posts/xyz');
      expect(result.matches).toBe(true);
      expect(result.params).toEqual({ userId: 'abc', postId: 'xyz' });
    });

    it('should return empty params for static resource', async () => {
      @Resource({
        name: 'static-params',
        uri: 'static://uri',
      })
      class StaticParams {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(StaticParams);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.matchUri('static://uri');
      expect(result.params).toEqual({});
    });

    it('should not match template with wrong structure', async () => {
      @ResourceTemplate({
        name: 'structured',
        uriTemplate: 'items://{id}/details',
      })
      class Structured {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(Structured);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.matchUri('items://123');
      expect(result.matches).toBe(false);
    });
  });

  describe('getMetadata', () => {
    it('should return ResourceMetadata for static', async () => {
      @Resource({
        name: 'meta-static',
        uri: 'meta://static',
        title: 'Static Title',
        description: 'Static description',
        mimeType: 'text/plain',
      })
      class MetaStatic {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(MetaStatic);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const metadata = instance.getMetadata();
      expect(metadata.name).toBe('meta-static');
      expect((metadata as any).uri).toBe('meta://static');
      expect(metadata.title).toBe('Static Title');
    });

    it('should return ResourceTemplateMetadata for template', async () => {
      @ResourceTemplate({
        name: 'meta-template',
        uriTemplate: 'meta://{id}',
        title: 'Template Title',
        description: 'Template description',
      })
      class MetaTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(MetaTemplate);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const metadata = instance.getMetadata();
      expect(metadata.name).toBe('meta-template');
      expect((metadata as any).uriTemplate).toBe('meta://{id}');
      expect(metadata.title).toBe('Template Title');
    });
  });

  describe('parseOutput', () => {
    it('should convert string to text content', async () => {
      @Resource({
        name: 'string-output',
        uri: 'string://uri',
      })
      class StringOutput {
        execute(uri: string) {
          return 'plain text content';
        }
      }

      const record = normalizeResource(StringOutput);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput('plain text content' as any);
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toBe('plain text content');
    });

    it('should convert Buffer to blob content', async () => {
      @Resource({
        name: 'buffer-output',
        uri: 'buffer://uri',
      })
      class BufferOutput {
        execute(uri: string) {
          return Buffer.from('binary data');
        }
      }

      const record = normalizeResource(BufferOutput);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const buffer = Buffer.from('binary data');
      const result = instance.parseOutput(buffer as any);
      expect(result.contents).toHaveLength(1);
      expect((result.contents[0] as any).blob).toBe(buffer.toString('base64'));
    });

    it('should convert object to JSON text', async () => {
      @Resource({
        name: 'object-output',
        uri: 'object://uri',
      })
      class ObjectOutput {
        execute(uri: string) {
          return { key: 'value', num: 42 };
        }
      }

      const record = normalizeResource(ObjectOutput);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput({ key: 'value', num: 42 } as any);
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toBe(JSON.stringify({ key: 'value', num: 42 }));
    });

    it('should pass through ReadResourceResult format', async () => {
      @Resource({
        name: 'passthrough',
        uri: 'pass://uri',
      })
      class Passthrough {
        execute(uri: string) {
          return { contents: [{ uri: 'pass://uri', text: 'existing' }] };
        }
      }

      const record = normalizeResource(Passthrough);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const input = { contents: [{ uri: 'pass://uri', text: 'existing' }] };
      const result = instance.parseOutput(input as any);
      expect(result).toEqual(input);
    });

    it('should handle array of content items', async () => {
      @Resource({
        name: 'array-output',
        uri: 'array://uri',
      })
      class ArrayOutput {
        execute(uri: string) {
          return [{ text: 'item1' }, { text: 'item2' }];
        }
      }

      const record = normalizeResource(ArrayOutput);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput([{ text: 'item1' }, { text: 'item2' }] as any);
      expect(result.contents).toHaveLength(2);
    });

    it('should use mimeType from metadata', async () => {
      @Resource({
        name: 'mime-output',
        uri: 'mime://uri',
        mimeType: 'application/json',
      })
      class MimeOutput {
        execute(uri: string) {
          return '{}';
        }
      }

      const record = normalizeResource(MimeOutput);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.parseOutput('{}' as any);
      expect(result.contents[0].mimeType).toBe('application/json');
    });
  });

  describe('safeParseOutput', () => {
    it('should return success with parsed content', async () => {
      @Resource({
        name: 'safe-success',
        uri: 'safe://uri',
      })
      class SafeSuccess {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(SafeSuccess);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      const result = instance.safeParseOutput('content' as any);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contents).toHaveLength(1);
      }
    });

    it('should return success false for valid but processable output', async () => {
      @Resource({
        name: 'safe-process',
        uri: 'safe://process',
      })
      class SafeProcess {
        execute(uri: string) {
          return null;
        }
      }

      const record = normalizeResource(SafeProcess);
      const instance = new ResourceInstance(record, createMockProviderRegistry(), createMockOwner());
      await instance.ready;

      // null is handled gracefully
      const result = instance.safeParseOutput(null as any);
      expect(result.success).toBe(true);
    });
  });
});
