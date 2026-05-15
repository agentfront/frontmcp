/**
 * Skill Instance Tests
 *
 * Tests for SkillInstance class which handles skill loading and caching.
 */

import 'reflect-metadata';

import { SkillKind, type EntryOwnerRef, type SkillMetadata, type SkillRecord } from '../../common';
import type ProviderRegistry from '../../provider/provider.registry';
import { type Scope } from '../../scope';
import { createSkillInstance, SkillInstance } from '../skill.instance';
import { loadInstructions, resolveExamples, resolveReferences } from '../skill.utils';

// Mock the loadInstructions utility (and the resource resolvers used by load()).
jest.mock('../skill.utils', () => ({
  ...jest.requireActual('../skill.utils'),
  loadInstructions: jest.fn(),
  resolveReferences: jest.fn(),
  resolveExamples: jest.fn(),
}));

const mockLoadInstructions = loadInstructions as jest.MockedFunction<typeof loadInstructions>;
const mockResolveReferences = resolveReferences as jest.MockedFunction<typeof resolveReferences>;
const mockResolveExamples = resolveExamples as jest.MockedFunction<typeof resolveExamples>;

// Helper to create mock ProviderRegistry
const createMockProviderRegistry = (): ProviderRegistry => {
  const mockScope = {
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as Scope;

  return {
    getActiveScope: () => mockScope,
  } as unknown as ProviderRegistry;
};

// Helper to create mock owner
const createMockOwner = (id = 'test-app'): EntryOwnerRef => ({
  kind: 'app',
  id,
  ref: Symbol('test-app-token'),
});

// Helper to create skill record
const createSkillRecord = (metadata: SkillMetadata, kind: SkillKind = SkillKind.VALUE): SkillRecord => {
  if (kind === SkillKind.FILE) {
    return {
      kind: SkillKind.FILE,
      provide: Symbol('test-skill'),
      metadata,
      filePath: '/path/to/skill.md',
    };
  }

  return {
    kind,
    provide: Symbol('test-skill'),
    metadata,
  } as SkillRecord;
};

describe('SkillInstance', () => {
  let mockProviders: ProviderRegistry;
  let mockOwner: EntryOwnerRef;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProviders = createMockProviderRegistry();
    mockOwner = createMockOwner();
    mockLoadInstructions.mockResolvedValue('Loaded instructions');
    mockResolveReferences.mockResolvedValue([]);
    mockResolveExamples.mockResolvedValue([]);
  });

  describe('constructor', () => {
    it('should create instance with basic metadata', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);

      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.name).toBe('test-skill');
      expect(instance.fullName).toBe('test-app:test-skill');
      expect(instance.owner).toBe(mockOwner);
    });

    it('should use id as name if provided', () => {
      const metadata: SkillMetadata = {
        id: 'custom-id',
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);

      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.name).toBe('custom-id');
      expect(instance.fullName).toBe('test-app:custom-id');
    });

    it('should cache metadata properties', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
        tags: ['tag1', 'tag2'],
        priority: 5,
        hideFromDiscovery: true,
      };
      const record = createSkillRecord(metadata);

      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getTags()).toEqual(['tag1', 'tag2']);
      expect(instance.getPriority()).toBe(5);
      expect(instance.isHidden()).toBe(true);
    });

    it('should use defaults for optional metadata', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);

      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getTags()).toEqual([]);
      expect(instance.getPriority()).toBe(0);
      expect(instance.isHidden()).toBe(false);
    });
  });

  describe('getDescription', () => {
    it('should return the description from metadata', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'This is a detailed description',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getDescription()).toBe('This is a detailed description');
    });
  });

  describe('loadInstructions', () => {
    it('should load instructions and cache them', async () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Inline instructions',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('Loaded instructions from source');

      const instructions1 = await instance.loadInstructions();
      const instructions2 = await instance.loadInstructions();

      expect(instructions1).toBe('Loaded instructions from source');
      expect(instructions2).toBe('Loaded instructions from source');
      // Should only call loadInstructions once due to caching
      expect(mockLoadInstructions).toHaveBeenCalledTimes(1);
    });

    it('should pass base path for file-based skills', async () => {
      const metadata: SkillMetadata = {
        name: 'file-skill',
        description: 'A file-based skill',
        instructions: { file: './instructions.md' },
      };
      const record = createSkillRecord(metadata, SkillKind.FILE);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      await instance.loadInstructions();

      expect(mockLoadInstructions).toHaveBeenCalledWith({ file: './instructions.md' }, '/path/to');
    });

    it('should not pass base path for value-based skills', async () => {
      const metadata: SkillMetadata = {
        name: 'value-skill',
        description: 'A value-based skill',
        instructions: 'Inline instructions',
      };
      const record = createSkillRecord(metadata, SkillKind.VALUE);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      await instance.loadInstructions();

      expect(mockLoadInstructions).toHaveBeenCalledWith('Inline instructions', undefined);
    });

    it('should pass callerDir as base path for CLASS_TOKEN records (issue #413)', async () => {
      const metadata: SkillMetadata = {
        name: 'class-token-skill',
        description: 'A class-decorated skill with captured callerDir',
        instructions: { file: './SKILL.md' },
      };
      const record = {
        kind: SkillKind.CLASS_TOKEN,
        provide: class {} as never,
        metadata,
        callerDir: '/abs/path/to/skill-dir',
      } as unknown as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      await instance.loadInstructions();

      expect(mockLoadInstructions).toHaveBeenCalledWith({ file: './SKILL.md' }, '/abs/path/to/skill-dir');
    });

    it('should pass callerDir as base path for VALUE records', async () => {
      const metadata: SkillMetadata = {
        name: 'value-skill-with-caller',
        description: 'A value skill that captured its caller dir',
        instructions: { file: './SKILL.md' },
      };
      const record = {
        kind: SkillKind.VALUE,
        provide: Symbol('caller-value-skill'),
        metadata,
        callerDir: '/abs/path/to/value-dir',
      } as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      await instance.loadInstructions();

      expect(mockLoadInstructions).toHaveBeenCalledWith({ file: './SKILL.md' }, '/abs/path/to/value-dir');
    });
  });

  describe('getBaseDir', () => {
    it('should return callerDir for CLASS_TOKEN records (issue #413)', () => {
      const metadata: SkillMetadata = {
        name: 'class-token-base-dir',
        description: 'A class-decorated skill with captured callerDir',
        instructions: 'Inline',
      };
      const record = {
        kind: SkillKind.CLASS_TOKEN,
        provide: class {} as never,
        metadata,
        callerDir: '/abs/path/to/class-dir',
      } as unknown as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getBaseDir()).toBe('/abs/path/to/class-dir');
    });

    it('should return callerDir for VALUE records', () => {
      const metadata: SkillMetadata = {
        name: 'value-base-dir',
        description: 'A value skill with captured callerDir',
        instructions: 'Inline',
      };
      const record = {
        kind: SkillKind.VALUE,
        provide: Symbol('base-dir-value'),
        metadata,
        callerDir: '/abs/path/to/value-dir',
      } as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getBaseDir()).toBe('/abs/path/to/value-dir');
    });

    it('should return undefined when CLASS_TOKEN has no callerDir', () => {
      const metadata: SkillMetadata = {
        name: 'class-token-no-caller',
        description: 'A class skill without callerDir',
        instructions: 'Inline',
      };
      const record = createSkillRecord(metadata, SkillKind.CLASS_TOKEN);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getBaseDir()).toBeUndefined();
    });
  });

  describe('load() — callerDir propagation for resources (issue #413)', () => {
    it('should resolve resources.references relative to callerDir for CLASS_TOKEN records', async () => {
      const metadata: SkillMetadata = {
        name: 'class-token-with-refs',
        description: 'CLASS_TOKEN skill that declares relative references',
        instructions: 'Inline',
        resources: { references: './references' },
      };
      const record = {
        kind: SkillKind.CLASS_TOKEN,
        provide: class {} as never,
        metadata,
        callerDir: '/abs/skill-dir',
      } as unknown as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      await instance.load();

      // loadResourceWithManifestFallback resolves `./references` against callerDir
      // before passing the absolute path to the loader.
      expect(mockResolveReferences).toHaveBeenCalledTimes(1);
      expect(mockResolveReferences.mock.calls[0][0]).toBe('/abs/skill-dir/references');
    });

    it('should resolve resources.examples relative to callerDir for CLASS_TOKEN records', async () => {
      const metadata: SkillMetadata = {
        name: 'class-token-with-examples',
        description: 'CLASS_TOKEN skill that declares relative examples',
        instructions: 'Inline',
        resources: { examples: './examples' },
      };
      const record = {
        kind: SkillKind.CLASS_TOKEN,
        provide: class {} as never,
        metadata,
        callerDir: '/abs/skill-dir',
      } as unknown as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      await instance.load();

      expect(mockResolveExamples).toHaveBeenCalledTimes(1);
      expect(mockResolveExamples.mock.calls[0][0]).toBe('/abs/skill-dir/examples');
    });
  });

  describe('loadInstructions() — ENOENT fallback regression (issue #413)', () => {
    it('should re-throw ENOENT when no skill manifest is available, even for CLASS_TOKEN records', async () => {
      const metadata: SkillMetadata = {
        name: 'class-token-enoent',
        description: 'CLASS_TOKEN skill whose file does not exist on disk',
        instructions: { file: './missing.md' },
      };
      const record = {
        kind: SkillKind.CLASS_TOKEN,
        provide: class {} as never,
        metadata,
        callerDir: '/abs/skill-dir',
      } as unknown as SkillRecord;
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      mockLoadInstructions.mockRejectedValueOnce(enoent);

      await expect(instance.loadInstructions()).rejects.toThrow(/ENOENT/);

      // First call uses the captured callerDir as base path.
      expect(mockLoadInstructions).toHaveBeenNthCalledWith(1, { file: './missing.md' }, '/abs/skill-dir');
    });
  });

  describe('load', () => {
    it('should load full skill content', async () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
        tools: ['tool1', { name: 'tool2', purpose: 'Does something' }],
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('Loaded instructions');

      const content = await instance.load();

      expect(content.id).toBe('test-skill');
      expect(content.name).toBe('test-skill');
      expect(content.description).toBe('A test skill');
      expect(content.instructions).toBe('Loaded instructions');
      expect(content.tools).toEqual([
        { name: 'tool1', purpose: undefined, required: false },
        { name: 'tool2', purpose: 'Does something', required: false },
      ]);
    });

    it('should cache loaded content', async () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('Loaded instructions');

      const content1 = await instance.load();
      const content2 = await instance.load();

      expect(content1).toBe(content2);
      expect(mockLoadInstructions).toHaveBeenCalledTimes(1);
    });

    it('should attach extra metadata to content', async () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
        tags: ['important'],
        priority: 10,
        hideFromDiscovery: true,
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('Loaded instructions');

      const content = await instance.load();
      const extendedContent = content as typeof content & {
        tags?: string[];
        priority?: number;
        hideFromDiscovery?: boolean;
      };

      expect(extendedContent.tags).toEqual(['important']);
      expect(extendedContent.priority).toBe(10);
      expect(extendedContent.hideFromDiscovery).toBe(true);
    });

    it('should include new spec fields in loaded content', async () => {
      const metadata: SkillMetadata = {
        name: 'spec-skill',
        description: 'A spec skill',
        instructions: 'Do something',
        license: 'MIT',
        compatibility: 'Node.js 18+',
        specMetadata: { author: 'test' },
        allowedTools: 'Read Edit',
        resources: { scripts: '/scripts', assets: '/assets' },
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('Loaded instructions');

      const content = await instance.load();

      expect(content.license).toBe('MIT');
      expect(content.compatibility).toBe('Node.js 18+');
      expect(content.specMetadata).toEqual({ author: 'test' });
      expect(content.allowedTools).toBe('Read Edit');
      expect(content.resources).toEqual({ scripts: '/scripts', assets: '/assets' });
    });
  });

  describe('getToolRefs', () => {
    it('should return normalized tool refs', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
        tools: ['simple-tool', { name: 'detailed-tool', purpose: 'Does something', required: true }],
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      const refs = instance.getToolRefs();

      expect(refs).toHaveLength(2);
      expect(refs[0]).toEqual({ name: 'simple-tool', required: false });
      expect(refs[1]).toEqual({ name: 'detailed-tool', purpose: 'Does something', required: true });
    });

    it('should return empty array when no tools', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getToolRefs()).toEqual([]);
    });
  });

  describe('getToolNames', () => {
    it('should return tool names only', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
        tools: ['tool1', { name: 'tool2', purpose: 'Does something' }],
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.getToolNames()).toEqual(['tool1', 'tool2']);
    });
  });

  describe('clearCache', () => {
    it('should clear cached instructions and content', async () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('First load');
      await instance.load();

      instance.clearCache();

      mockLoadInstructions.mockResolvedValue('Second load');
      const content = await instance.load();

      expect(content.instructions).toBe('Second load');
      expect(mockLoadInstructions).toHaveBeenCalledTimes(2);
    });
  });

  describe('getContentSync', () => {
    it('should return cached content if available', async () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Inline instructions',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);
      await instance.ready;

      mockLoadInstructions.mockResolvedValue('Loaded');
      await instance.load();

      const content = instance.getContentSync();
      expect(content).toBeDefined();
      expect(content?.instructions).toBe('Loaded');
    });

    it('should return content for inline instructions without async load', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Inline instructions here',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      const content = instance.getContentSync();

      expect(content).toBeDefined();
      expect(content?.instructions).toBe('Inline instructions here');
    });

    it('should return undefined for file-based instructions without cache', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: { file: './instructions.md' },
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      const content = instance.getContentSync();

      expect(content).toBeUndefined();
    });

    it('should return undefined for URL-based instructions without cache', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: { url: 'https://example.com/instructions.md' },
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      const content = instance.getContentSync();

      expect(content).toBeUndefined();
    });
  });

  describe('providers getter', () => {
    it('should return the provider registry', () => {
      const metadata: SkillMetadata = {
        name: 'test-skill',
        description: 'A test skill',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);
      const instance = new SkillInstance(record, mockProviders, mockOwner);

      expect(instance.providers).toBe(mockProviders);
    });
  });

  describe('createSkillInstance helper', () => {
    it('should create a SkillInstance', () => {
      const metadata: SkillMetadata = {
        name: 'factory-skill',
        description: 'A skill created via factory',
        instructions: 'Do something',
      };
      const record = createSkillRecord(metadata);

      const instance = createSkillInstance(record, mockProviders, mockOwner);

      expect(instance).toBeInstanceOf(SkillInstance);
      expect(instance.name).toBe('factory-skill');
    });
  });
});
