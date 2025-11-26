import 'reflect-metadata';
import {
  Resource,
  ResourceTemplate,
  resource,
  resourceTemplate,
  FrontMcpResource,
  FrontMcpResourceTemplate,
} from '../../common/decorators/resource.decorator';
import { FrontMcpResourceTokens, FrontMcpResourceTemplateTokens } from '../../common';

describe('Resource Decorators', () => {
  describe('@Resource decorator', () => {
    it('should apply metadata to class', () => {
      @Resource({
        name: 'test-resource',
        uri: 'test://resource',
      })
      class TestResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const hasType = Reflect.getMetadata(FrontMcpResourceTokens.type, TestResource);
      expect(hasType).toBe(true);
    });

    it('should require name and uri', () => {
      @Resource({
        name: 'my-resource',
        uri: 'my://uri',
      })
      class TestResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const name = Reflect.getMetadata(FrontMcpResourceTokens.name, TestResource);
      const uri = Reflect.getMetadata(FrontMcpResourceTokens.uri, TestResource);

      expect(name).toBe('my-resource');
      expect(uri).toBe('my://uri');
    });

    it('should accept optional title, description, mimeType, icons', () => {
      @Resource({
        name: 'full-resource',
        uri: 'full://uri',
        title: 'Full Resource',
        description: 'A fully specified resource',
        mimeType: 'application/json',
        icons: [{ src: 'https://example.com/icon.png' }],
      })
      class FullResource {
        execute(uri: string) {
          return { text: '{}' };
        }
      }

      expect(Reflect.getMetadata(FrontMcpResourceTokens.title, FullResource)).toBe('Full Resource');
      expect(Reflect.getMetadata(FrontMcpResourceTokens.description, FullResource)).toBe('A fully specified resource');
      expect(Reflect.getMetadata(FrontMcpResourceTokens.mimeType, FullResource)).toBe('application/json');
      expect(Reflect.getMetadata(FrontMcpResourceTokens.icons, FullResource)).toEqual([
        { src: 'https://example.com/icon.png' },
      ]);
    });

    it('should store metadata via FrontMcpResourceTokens', () => {
      @Resource({
        name: 'token-test',
        uri: 'token://test',
      })
      class TokenTest {
        execute(uri: string) {
          return { text: 'test' };
        }
      }

      // Verify all tokens are accessible
      expect(Reflect.getMetadata(FrontMcpResourceTokens.type, TokenTest)).toBe(true);
      expect(Reflect.getMetadata(FrontMcpResourceTokens.name, TokenTest)).toBe('token-test');
      expect(Reflect.getMetadata(FrontMcpResourceTokens.uri, TokenTest)).toBe('token://test');
    });

    it('should be aliased as FrontMcpResource', () => {
      @FrontMcpResource({
        name: 'aliased',
        uri: 'alias://uri',
      })
      class AliasedResource {
        execute(uri: string) {
          return { text: 'aliased' };
        }
      }

      expect(Reflect.getMetadata(FrontMcpResourceTokens.type, AliasedResource)).toBe(true);
      expect(Reflect.getMetadata(FrontMcpResourceTokens.name, AliasedResource)).toBe('aliased');
    });
  });

  describe('@ResourceTemplate decorator', () => {
    it('should apply metadata to class', () => {
      @ResourceTemplate({
        name: 'test-template',
        uriTemplate: 'test://resource/{id}',
      })
      class TestTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: `content for ${params['id']}` };
        }
      }

      const hasType = Reflect.getMetadata(FrontMcpResourceTemplateTokens.type, TestTemplate);
      expect(hasType).toBe(true);
    });

    it('should require name and uriTemplate', () => {
      @ResourceTemplate({
        name: 'my-template',
        uriTemplate: 'users://{userId}/profile',
      })
      class TestTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const name = Reflect.getMetadata(FrontMcpResourceTemplateTokens.name, TestTemplate);
      const uriTemplate = Reflect.getMetadata(FrontMcpResourceTemplateTokens.uriTemplate, TestTemplate);

      expect(name).toBe('my-template');
      expect(uriTemplate).toBe('users://{userId}/profile');
    });

    it('should accept optional title, description, mimeType, icons', () => {
      @ResourceTemplate({
        name: 'full-template',
        uriTemplate: 'full://{id}',
        title: 'Full Template',
        description: 'A fully specified template',
        mimeType: 'text/markdown',
        icons: [{ src: 'https://example.com/template-icon.png' }],
      })
      class FullTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: '# Content' };
        }
      }

      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.title, FullTemplate)).toBe('Full Template');
      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.description, FullTemplate)).toBe(
        'A fully specified template',
      );
      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.mimeType, FullTemplate)).toBe('text/markdown');
      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.icons, FullTemplate)).toEqual([
        { src: 'https://example.com/template-icon.png' },
      ]);
    });

    it('should store metadata via FrontMcpResourceTemplateTokens', () => {
      @ResourceTemplate({
        name: 'token-test',
        uriTemplate: 'token://{param}',
      })
      class TokenTest {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'test' };
        }
      }

      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.type, TokenTest)).toBe(true);
      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.name, TokenTest)).toBe('token-test');
      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.uriTemplate, TokenTest)).toBe('token://{param}');
    });

    it('should be aliased as FrontMcpResourceTemplate', () => {
      @FrontMcpResourceTemplate({
        name: 'aliased',
        uriTemplate: 'alias://{id}',
      })
      class AliasedTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'aliased' };
        }
      }

      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.type, AliasedTemplate)).toBe(true);
      expect(Reflect.getMetadata(FrontMcpResourceTemplateTokens.name, AliasedTemplate)).toBe('aliased');
    });
  });

  describe('resource() function builder', () => {
    it('should create function-style resource', () => {
      const MyResource = resource({
        name: 'func-resource',
        uri: 'func://uri',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      expect(typeof MyResource).toBe('function');
    });

    it('should mark type as function-resource', () => {
      const MyResource = resource({
        name: 'typed-resource',
        uri: 'typed://uri',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      expect((MyResource as any)[FrontMcpResourceTokens.type]).toBe('function-resource');
    });

    it('should attach metadata to function', () => {
      const MyResource = resource({
        name: 'meta-resource',
        uri: 'meta://uri',
        title: 'Meta Resource',
        description: 'Resource with metadata',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      const metadata = (MyResource as any)[FrontMcpResourceTokens.metadata];

      expect(metadata.name).toBe('meta-resource');
      expect(metadata.uri).toBe('meta://uri');
      expect(metadata.title).toBe('Meta Resource');
      expect(metadata.description).toBe('Resource with metadata');
    });

    it('should return execute function when called', () => {
      const MyResource = resource({
        name: 'callable',
        uri: 'call://uri',
      })((uri) => ({ contents: [{ uri, text: 'test content' }] }));

      const execute = MyResource();
      expect(typeof execute).toBe('function');
    });
  });

  describe('resourceTemplate() function builder', () => {
    it('should create function-style template', () => {
      const MyTemplate = resourceTemplate({
        name: 'func-template',
        uriTemplate: 'func://{id}',
      })((uri, params) => ({ contents: [{ uri, text: `content for ${params['id']}` }] }));

      expect(typeof MyTemplate).toBe('function');
    });

    it('should mark type as function-resource-template', () => {
      const MyTemplate = resourceTemplate({
        name: 'typed-template',
        uriTemplate: 'typed://{id}',
      })((uri, params) => ({ contents: [{ uri, text: 'content' }] }));

      expect((MyTemplate as any)[FrontMcpResourceTemplateTokens.type]).toBe('function-resource-template');
    });

    it('should attach metadata to function', () => {
      const MyTemplate = resourceTemplate({
        name: 'meta-template',
        uriTemplate: 'meta://{userId}/profile',
        title: 'Meta Template',
        description: 'Template with metadata',
      })((uri, params) => ({ contents: [{ uri, text: 'content' }] }));

      const metadata = (MyTemplate as any)[FrontMcpResourceTemplateTokens.metadata];

      expect(metadata.name).toBe('meta-template');
      expect(metadata.uriTemplate).toBe('meta://{userId}/profile');
      expect(metadata.title).toBe('Meta Template');
      expect(metadata.description).toBe('Template with metadata');
    });

    it('should return execute function when called', () => {
      const MyTemplate = resourceTemplate({
        name: 'callable',
        uriTemplate: 'call://{id}',
      })((uri, params) => ({ contents: [{ uri, text: `user ${params['id']}` }] }));

      const execute = MyTemplate();
      expect(typeof execute).toBe('function');
    });

    it('should pass params to execute handler', () => {
      const MyTemplate = resourceTemplate({
        name: 'params-test',
        uriTemplate: 'users://{userId}/posts/{postId}',
      })((uri, params) => ({
        contents: [{ uri, text: `User: ${params['userId']}, Post: ${params['postId']}` }],
      }));

      const execute = MyTemplate();
      const result = execute('users://123/posts/456', { userId: '123', postId: '456' });

      expect(result).toEqual({
        contents: [{ uri: 'users://123/posts/456', text: 'User: 123, Post: 456' }],
      });
    });
  });
});
