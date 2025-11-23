/**
 * Tests for Tool Vector Database
 *
 * Note: These tests use transformers.js which downloads models on first run.
 * Models are cached in ./.cache/transformers
 */

import { ToolVectorDatabase } from '../vector-db.service';
import { EmbeddingService } from '../embedding.service';
import { cosineSimilarity } from '../similarity.utils';
import type { ToolData, ToolEmbeddingMetadata } from '../vector-db.interface';

describe('ToolVectorDatabase', () => {
  let vectorDb: ToolVectorDatabase;

  beforeAll(async () => {
    // Initialize once for all tests
    vectorDb = new ToolVectorDatabase({
      defaultTopK: 5,
      defaultSimilarityThreshold: 0.3,
    });
    await vectorDb.initialize();
  }, 60000); // Allow time for model download

  afterEach(() => {
    // Clear between tests
    vectorDb.clear();
  });

  describe('Basic Operations', () => {
    test('should add a tool and retrieve it', async () => {
      const toolData: ToolData = {
        name: 'create_user',
        description: 'Create a new user account',
        tags: ['user', 'admin'],
      };

      const metadata: ToolEmbeddingMetadata = {
        toolId: 'tool-1',
        toolName: 'create_user',
        appId: 'portal',
      };

      await vectorDb.addTool('tool-1', toolData, metadata);

      expect(vectorDb.has('tool-1')).toBe(true);
      expect(vectorDb.size()).toBe(1);

      const embedding = vectorDb.get('tool-1');
      expect(embedding).toBeDefined();
      expect(embedding?.metadata.toolName).toBe('create_user');
    });

    test('should add multiple tools in batch', async () => {
      const tools = [
        {
          id: 'tool-1',
          toolData: {
            name: 'create_user',
            description: 'Create a user',
          } as ToolData,
          metadata: {
            toolId: 'tool-1',
            toolName: 'create_user',
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-2',
          toolData: {
            name: 'delete_user',
            description: 'Delete a user',
          } as ToolData,
          metadata: {
            toolId: 'tool-2',
            toolName: 'delete_user',
          } as ToolEmbeddingMetadata,
        },
      ];

      await vectorDb.addTools(tools);

      expect(vectorDb.size()).toBe(2);
      expect(vectorDb.has('tool-1')).toBe(true);
      expect(vectorDb.has('tool-2')).toBe(true);
    });

    test('should remove a tool', async () => {
      await vectorDb.addTool(
        'tool-1',
        { name: 'test_tool' } as ToolData,
        { toolId: 'tool-1', toolName: 'test_tool' } as ToolEmbeddingMetadata,
      );

      expect(vectorDb.has('tool-1')).toBe(true);

      const removed = vectorDb.remove('tool-1');
      expect(removed).toBe(true);
      expect(vectorDb.has('tool-1')).toBe(false);
      expect(vectorDb.size()).toBe(0);
    });

    test('should clear all tools', async () => {
      await vectorDb.addTools([
        {
          id: 'tool-1',
          toolData: { name: 'tool1' } as ToolData,
          metadata: {
            toolId: 'tool-1',
            toolName: 'tool1',
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-2',
          toolData: { name: 'tool2' } as ToolData,
          metadata: {
            toolId: 'tool-2',
            toolName: 'tool2',
          } as ToolEmbeddingMetadata,
        },
      ]);

      expect(vectorDb.size()).toBe(2);
      vectorDb.clear();
      expect(vectorDb.size()).toBe(0);
    });
  });

  describe('Semantic Search', () => {
    beforeEach(async () => {
      // Add sample tools
      await vectorDb.addTools([
        {
          id: 'tool-1',
          toolData: {
            name: 'create_user',
            description: 'Create a new user account in the system',
            tags: ['user', 'admin'],
          } as ToolData,
          metadata: {
            toolId: 'tool-1',
            toolName: 'create_user',
            appId: 'portal',
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-2',
          toolData: {
            name: 'send_email',
            description: 'Send an email notification to a user',
            tags: ['email', 'notification'],
          } as ToolData,
          metadata: {
            toolId: 'tool-2',
            toolName: 'send_email',
            appId: 'portal',
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-3',
          toolData: {
            name: 'upload_file',
            description: 'Upload a file to cloud storage',
            tags: ['storage', 'file'],
          } as ToolData,
          metadata: {
            toolId: 'tool-3',
            toolName: 'upload_file',
            appId: 'storage',
          } as ToolEmbeddingMetadata,
        },
      ]);
    });

    test('should find relevant tools based on query', async () => {
      const results = await vectorDb.search('how to create an account', {
        topK: 2,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].metadata.toolName).toBe('create_user');
      expect(results[0].score).toBeGreaterThan(0.3);
    });

    test('should respect topK parameter', async () => {
      const results = await vectorDb.search('user', { topK: 1 });

      expect(results.length).toBeLessThanOrEqual(1);
    });

    test('should respect threshold parameter', async () => {
      const results = await vectorDb.search('completely unrelated query xyz', {
        threshold: 0.8,
      });

      // Should return few or no results due to high threshold
      expect(results.length).toBeLessThan(3);
    });

    test('should return results sorted by score', async () => {
      const results = await vectorDb.search('user account', { topK: 3 });

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('Metadata Filtering', () => {
    beforeEach(async () => {
      await vectorDb.addTools([
        {
          id: 'tool-1',
          toolData: {
            name: 'create_user',
            description: 'Create a user',
          } as ToolData,
          metadata: {
            toolId: 'tool-1',
            toolName: 'create_user',
            appId: 'portal',
            providerId: 'auth',
            tags: ['user', 'admin'],
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-2',
          toolData: {
            name: 'delete_user',
            description: 'Delete a user',
          } as ToolData,
          metadata: {
            toolId: 'tool-2',
            toolName: 'delete_user',
            appId: 'portal',
            providerId: 'auth',
            tags: ['user', 'admin'],
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-3',
          toolData: {
            name: 'send_email',
            description: 'Send email',
          } as ToolData,
          metadata: {
            toolId: 'tool-3',
            toolName: 'send_email',
            appId: 'portal',
            providerId: 'notification',
            tags: ['email'],
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-4',
          toolData: {
            name: 'upload_file',
            description: 'Upload file',
          } as ToolData,
          metadata: {
            toolId: 'tool-4',
            toolName: 'upload_file',
            appId: 'storage',
            providerId: 's3',
            tags: ['file'],
          } as ToolEmbeddingMetadata,
        },
      ]);
    });

    test('should filter by appId', async () => {
      const results = await vectorDb.search('user', {
        filter: { appId: 'portal' },
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => {
        expect(r.metadata.appId).toBe('portal');
      });
    });

    test('should filter by multiple appIds', async () => {
      const results = await vectorDb.search('data', {
        filter: { appId: ['portal', 'storage'] },
      });

      results.forEach((r) => {
        expect(['portal', 'storage']).toContain(r.metadata.appId);
      });
    });

    test('should filter by providerId', async () => {
      const results = await vectorDb.search('user', {
        filter: { providerId: 'auth' },
      });

      results.forEach((r) => {
        expect(r.metadata.providerId).toBe('auth');
      });
    });

    test('should filter by tags', async () => {
      const results = await vectorDb.search('manage', {
        filter: { tags: ['user'] },
      });

      results.forEach((r) => {
        expect(r.metadata.tags).toContain('user');
      });
    });

    test('should filter by toolNames (authorization)', async () => {
      const authorizedTools = ['create_user', 'send_email'];

      const results = await vectorDb.search('create', {
        filter: { toolNames: authorizedTools },
      });

      results.forEach((r) => {
        expect(authorizedTools).toContain(r.metadata.toolName);
      });
    });

    test('should combine multiple filters', async () => {
      const results = await vectorDb.search('user', {
        filter: {
          appId: 'portal',
          providerId: 'auth',
          tags: ['admin'],
        },
      });

      results.forEach((r) => {
        expect(r.metadata.appId).toBe('portal');
        expect(r.metadata.providerId).toBe('auth');
        expect(r.metadata.tags).toContain('admin');
      });
    });
  });

  describe('Statistics', () => {
    test('should provide accurate statistics', async () => {
      await vectorDb.addTools([
        {
          id: 'tool-1',
          toolData: { name: 'tool1' } as ToolData,
          metadata: {
            toolId: 'tool-1',
            toolName: 'tool1',
            appId: 'app1',
            providerId: 'provider1',
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-2',
          toolData: { name: 'tool2' } as ToolData,
          metadata: {
            toolId: 'tool-2',
            toolName: 'tool2',
            appId: 'app1',
            providerId: 'provider2',
          } as ToolEmbeddingMetadata,
        },
        {
          id: 'tool-3',
          toolData: { name: 'tool3' } as ToolData,
          metadata: {
            toolId: 'tool-3',
            toolName: 'tool3',
            appId: 'app2',
            providerId: 'provider1',
          } as ToolEmbeddingMetadata,
        },
      ]);

      const stats = vectorDb.getStats();

      expect(stats.totalEmbeddings).toBe(3);
      expect(stats.dimensions).toBe(384); // all-MiniLM-L6-v2
      expect(stats.modelName).toContain('MiniLM');
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);

      expect(stats.breakdown.byAppId['app1']).toBe(2);
      expect(stats.breakdown.byAppId['app2']).toBe(1);
      expect(stats.breakdown.byProviderId['provider1']).toBe(2);
      expect(stats.breakdown.byProviderId['provider2']).toBe(1);
    });
  });
});

describe('EmbeddingService', () => {
  let embeddingService: EmbeddingService;

  beforeAll(async () => {
    embeddingService = new EmbeddingService();
    await embeddingService.initialize();
  }, 60000);

  test('should generate embedding for text', async () => {
    const embedding = await embeddingService.generateEmbedding('test text');

    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(384); // all-MiniLM-L6-v2
  });

  test('should generate embeddings in batch', async () => {
    const texts = ['text 1', 'text 2', 'text 3'];
    const embeddings = await embeddingService.generateEmbeddings(texts);

    expect(embeddings.length).toBe(3);
    embeddings.forEach((embedding) => {
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
  });

  test('should convert tool to text', () => {
    const toolData: ToolData = {
      name: 'create_user',
      description: 'Create a new user account',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'User email' },
        },
      },
      tags: ['user', 'admin'],
    };

    const text = embeddingService.toolToText(toolData);

    expect(text).toContain('create_user');
    expect(text).toContain('Create a new user account');
    expect(text).toContain('user, admin');
  });
});

describe('Similarity Utils', () => {
  test('should calculate cosine similarity correctly', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);

    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(1.0, 5);
  });

  test('should calculate cosine similarity for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);

    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(0.0, 5);
  });

  test('should calculate cosine similarity for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);

    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeCloseTo(-1.0, 5);
  });

  test('should handle similar but not identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3.1]);

    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.99);
    expect(similarity).toBeLessThan(1.0);
  });
});
