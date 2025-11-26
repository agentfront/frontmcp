import 'reflect-metadata';
import {
  collectResourceMetadata,
  collectResourceTemplateMetadata,
  normalizeResource,
  normalizeResourceTemplate,
  isResourceTemplate,
  resourceDiscoveryDeps,
} from '../resource.utils';
import { Resource, ResourceTemplate, resource } from '../../common/decorators/resource.decorator';
import { FrontMcpResourceTokens, FrontMcpResourceTemplateTokens } from '../../common/tokens';
import { ResourceKind } from '../../common/records';
import { ResourceTemplateKind } from '../resource.types';

describe('Resource Utils', () => {
  describe('collectResourceMetadata', () => {
    it('should collect metadata from decorated class', () => {
      @Resource({
        name: 'test-resource',
        uri: 'test://uri',
        title: 'Test Resource',
        description: 'A test resource',
        mimeType: 'text/plain',
      })
      class TestResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const metadata = collectResourceMetadata(TestResource as any);

      expect(metadata.name).toBe('test-resource');
      expect(metadata.uri).toBe('test://uri');
      expect(metadata.title).toBe('Test Resource');
      expect(metadata.description).toBe('A test resource');
      expect(metadata.mimeType).toBe('text/plain');
    });

    it('should return empty object for undecorated class', () => {
      class PlainClass {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const metadata = collectResourceMetadata(PlainClass as any);

      expect(metadata).toEqual({});
    });

    it('should collect only defined properties', () => {
      @Resource({
        name: 'minimal',
        uri: 'min://uri',
      })
      class MinimalResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const metadata = collectResourceMetadata(MinimalResource as any);

      expect(metadata.name).toBe('minimal');
      expect(metadata.uri).toBe('min://uri');
      expect(metadata.title).toBeUndefined();
      expect(metadata.description).toBeUndefined();
    });
  });

  describe('collectResourceTemplateMetadata', () => {
    it('should collect template metadata from decorated class', () => {
      @ResourceTemplate({
        name: 'test-template',
        uriTemplate: 'test://{id}',
        title: 'Test Template',
        description: 'A test template',
        mimeType: 'application/json',
      })
      class TestTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: '{}' };
        }
      }

      const metadata = collectResourceTemplateMetadata(TestTemplate as any);

      expect(metadata.name).toBe('test-template');
      expect(metadata.uriTemplate).toBe('test://{id}');
      expect(metadata.title).toBe('Test Template');
      expect(metadata.description).toBe('A test template');
      expect(metadata.mimeType).toBe('application/json');
    });

    it('should return empty object for undecorated class', () => {
      class PlainClass {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const metadata = collectResourceTemplateMetadata(PlainClass as any);

      expect(metadata).toEqual({});
    });
  });

  describe('normalizeResource', () => {
    it('should normalize class-based resource to ResourceRecord', () => {
      @Resource({
        name: 'class-resource',
        uri: 'class://uri',
      })
      class ClassResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(ClassResource);

      expect(record.kind).toBe(ResourceKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('class-resource');
      expect(record.metadata.uri).toBe('class://uri');
    });

    it('should normalize function-based resource to ResourceRecord', () => {
      const FuncResource = resource({
        name: 'func-resource',
        uri: 'func://uri',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      const record = normalizeResource(FuncResource);

      expect(record.kind).toBe(ResourceKind.FUNCTION);
      expect(record.metadata.name).toBe('func-resource');
      expect(record.metadata.uri).toBe('func://uri');
    });

    it('should throw for invalid input', () => {
      expect(() => normalizeResource(null)).toThrow(/Invalid resource/);
      expect(() => normalizeResource(undefined)).toThrow(/Invalid resource/);
      expect(() => normalizeResource('string')).toThrow(/Invalid resource/);
      expect(() => normalizeResource(123)).toThrow(/Invalid resource/);
    });

    it('should set kind to CLASS_TOKEN for class', () => {
      @Resource({
        name: 'kind-test',
        uri: 'kind://uri',
      })
      class KindTest {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(KindTest);

      expect(record.kind).toBe(ResourceKind.CLASS_TOKEN);
    });

    it('should set kind to FUNCTION for function', () => {
      const FuncResource = resource({
        name: 'kind-func',
        uri: 'kind://func',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      const record = normalizeResource(FuncResource);

      expect(record.kind).toBe(ResourceKind.FUNCTION);
    });
  });

  describe('normalizeResourceTemplate', () => {
    it('should normalize class-based template to ResourceTemplateRecord', () => {
      @ResourceTemplate({
        name: 'class-template',
        uriTemplate: 'class://{id}',
      })
      class ClassTemplate {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(ClassTemplate);

      expect(record.kind).toBe(ResourceTemplateKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('class-template');
      expect(record.metadata.uriTemplate).toBe('class://{id}');
    });

    it('should throw for invalid input', () => {
      expect(() => normalizeResourceTemplate(null)).toThrow(/Invalid resource template/);
      expect(() => normalizeResourceTemplate(undefined)).toThrow(/Invalid resource template/);
      expect(() => normalizeResourceTemplate('string')).toThrow(/Invalid resource template/);
    });
  });

  describe('isResourceTemplate', () => {
    it('should return true for function-style template', () => {
      const funcTemplate = function () {
        return () => {};
      };
      Object.assign(funcTemplate, {
        [FrontMcpResourceTemplateTokens.type]: 'function-resource-template',
      });

      expect(isResourceTemplate(funcTemplate)).toBe(true);
    });

    it('should return true for class with uriTemplate metadata', () => {
      @ResourceTemplate({
        name: 'template',
        uriTemplate: 'template://{id}',
      })
      class Template {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      expect(isResourceTemplate(Template)).toBe(true);
    });

    it('should return false for static resource', () => {
      @Resource({
        name: 'static',
        uri: 'static://uri',
      })
      class StaticResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      expect(isResourceTemplate(StaticResource)).toBe(false);
    });

    it('should return false for non-resource', () => {
      class PlainClass {}

      expect(isResourceTemplate(PlainClass)).toBe(false);
      expect(isResourceTemplate(null)).toBe(false);
      expect(isResourceTemplate(undefined)).toBe(false);
      expect(isResourceTemplate('string')).toBe(false);
    });

    it('should return false for function-style static resource', () => {
      const FuncResource = resource({
        name: 'func-static',
        uri: 'func://static',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      expect(isResourceTemplate(FuncResource)).toBe(false);
    });
  });

  describe('resourceDiscoveryDeps', () => {
    it('should return constructor deps for CLASS_TOKEN', () => {
      @Resource({
        name: 'deps-test',
        uri: 'deps://test',
      })
      class DepsResource {
        execute(uri: string) {
          return { text: 'content' };
        }
      }

      const record = normalizeResource(DepsResource);
      const deps = resourceDiscoveryDeps(record);

      // Class with no constructor params should have empty deps
      expect(Array.isArray(deps)).toBe(true);
    });

    it('should return function params for FUNCTION', () => {
      const FuncResource = resource({
        name: 'func-deps',
        uri: 'func://deps',
      })((uri) => ({ contents: [{ uri, text: 'content' }] }));

      const record = normalizeResource(FuncResource);
      const deps = resourceDiscoveryDeps(record);

      expect(Array.isArray(deps)).toBe(true);
    });

    it('should handle template records', () => {
      @ResourceTemplate({
        name: 'template-deps',
        uriTemplate: 'template://{id}',
      })
      class TemplateResource {
        execute(uri: string, params: Record<string, string>) {
          return { text: 'content' };
        }
      }

      const record = normalizeResourceTemplate(TemplateResource);
      const deps = resourceDiscoveryDeps(record);

      expect(Array.isArray(deps)).toBe(true);
    });
  });
});
