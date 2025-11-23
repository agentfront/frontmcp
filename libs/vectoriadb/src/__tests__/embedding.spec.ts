import * as fs from 'fs/promises';
import { EmbeddingService, EmbeddingError } from '../index';

describe('EmbeddingService', () => {
  let embeddingService: EmbeddingService;

  beforeAll(async () => {
    embeddingService = new EmbeddingService();
    await embeddingService.initialize();
  }, 60000); // Allow time for model download

  describe('initialization', () => {
    test('should initialize successfully', () => {
      expect(embeddingService.isReady()).toBe(true);
    });

    test('should detect correct dimensions', () => {
      const dimensions = embeddingService.getDimensions();
      expect(dimensions).toBe(384); // all-MiniLM-L6-v2 has 384 dimensions
    });

    test('should return correct model name', () => {
      const modelName = embeddingService.getModelName();
      expect(modelName).toBe('Xenova/all-MiniLM-L6-v2');
    });

    test('should allow re-initialization without error', async () => {
      await expect(embeddingService.initialize()).resolves.not.toThrow();
    });
  });

  describe('generateEmbedding', () => {
    test('should generate embedding for a single text', async () => {
      const embedding = await embeddingService.generateEmbedding('test text');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should generate different embeddings for different texts', async () => {
      const embedding1 = await embeddingService.generateEmbedding('hello world');
      const embedding2 = await embeddingService.generateEmbedding('goodbye world');

      expect(embedding1).not.toEqual(embedding2);

      // Check that they are actually different
      let hasDifference = false;
      for (let i = 0; i < embedding1.length; i++) {
        if (embedding1[i] !== embedding2[i]) {
          hasDifference = true;
          break;
        }
      }
      expect(hasDifference).toBe(true);
    });

    test('should generate similar embeddings for similar texts', async () => {
      const embedding1 = await embeddingService.generateEmbedding('create user account');
      const embedding2 = await embeddingService.generateEmbedding('creating user accounts');

      // Calculate cosine similarity
      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let i = 0; i < embedding1.length; i++) {
        dotProduct += embedding1[i] * embedding2[i];
        norm1 += embedding1[i] * embedding1[i];
        norm2 += embedding2[i] * embedding2[i];
      }

      const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
      expect(similarity).toBeGreaterThan(0.7); // Should be very similar
    });

    test('should handle empty string', async () => {
      const embedding = await embeddingService.generateEmbedding('');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle long text', async () => {
      const longText = 'This is a very long text. '.repeat(100);
      const embedding = await embeddingService.generateEmbedding(longText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });
  });

  describe('generateEmbeddings (batch)', () => {
    test('should generate embeddings for multiple texts', async () => {
      const texts = ['text 1', 'text 2', 'text 3'];
      const embeddings = await embeddingService.generateEmbeddings(texts);

      expect(embeddings.length).toBe(3);
      embeddings.forEach((embedding) => {
        expect(embedding).toBeInstanceOf(Float32Array);
        expect(embedding.length).toBe(384);
      });
    });

    test('should handle empty array', async () => {
      const embeddings = await embeddingService.generateEmbeddings([]);
      expect(embeddings.length).toBe(0);
    });

    test('should handle large batches', async () => {
      const texts = Array.from({ length: 100 }, (_, i) => `text ${i}`);
      const embeddings = await embeddingService.generateEmbeddings(texts);

      expect(embeddings.length).toBe(100);
      embeddings.forEach((embedding) => {
        expect(embedding).toBeInstanceOf(Float32Array);
        expect(embedding.length).toBe(384);
      });
    }, 120000); // Allow extra time for large batch
  });

  describe('custom model', () => {
    test('should allow custom model name', async () => {
      const customService = new EmbeddingService('Xenova/all-MiniLM-L6-v2');
      await customService.initialize();

      expect(customService.getModelName()).toBe('Xenova/all-MiniLM-L6-v2');
      expect(customService.isReady()).toBe(true);
    }, 60000);
  });

  describe('error handling and edge cases', () => {
    test('should handle whitespace-only string', async () => {
      const embedding = await embeddingService.generateEmbedding('   ');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle very long text', async () => {
      const longText = 'word '.repeat(1000); // 5000 characters
      const embedding = await embeddingService.generateEmbedding(longText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    }, 60000);

    test('should handle special characters', async () => {
      const specialText = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./`~';
      const embedding = await embeddingService.generateEmbedding(specialText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle unicode characters', async () => {
      const unicodeText = '你好世界 🌍 مرحبا العالم';
      const embedding = await embeddingService.generateEmbedding(unicodeText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle emoji text', async () => {
      const emojiText = '😀 😃 😄 😁 🎉 🎊 🎈';
      const embedding = await embeddingService.generateEmbedding(emojiText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle empty batch', async () => {
      const embeddings = await embeddingService.generateEmbeddings([]);
      expect(embeddings).toEqual([]);
    });

    test('should handle batch with one item', async () => {
      const embeddings = await embeddingService.generateEmbeddings(['single text']);

      expect(embeddings.length).toBe(1);
      expect(embeddings[0]).toBeInstanceOf(Float32Array);
      expect(embeddings[0].length).toBe(384);
    });

    test('should handle batch with mixed empty and non-empty strings', async () => {
      const embeddings = await embeddingService.generateEmbeddings(['text', '', 'more text', '   ']);

      expect(embeddings.length).toBe(4);
      embeddings.forEach((embedding) => {
        expect(embedding).toBeInstanceOf(Float32Array);
        expect(embedding.length).toBe(384);
      });
    });

    test('should isReady return false before initialization', () => {
      const service = new EmbeddingService();

      expect(service.isReady()).toBe(false);
    });

    test('should getDimensions return correct value after initialization', async () => {
      expect(embeddingService.getDimensions()).toBe(384);
    });

    test('should handle numbers as text', async () => {
      const embedding = await embeddingService.generateEmbedding('123456789');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle repeated initialization gracefully', async () => {
      const service = new EmbeddingService();
      await service.initialize();
      await service.initialize(); // Second initialization

      expect(service.isReady()).toBe(true);
    }, 60000);

    test('should use custom cache directory', async () => {
      const customCacheDir = './tmp/custom-cache-test';
      const service = new EmbeddingService('Xenova/all-MiniLM-L6-v2', customCacheDir);
      await service.initialize();

      expect(service.isReady()).toBe(true);

      // Cleanup
      try {
        await fs.rm(customCacheDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }, 60000);

    test('should handle concurrent initialization calls', async () => {
      const service = new EmbeddingService();

      // Call initialize() multiple times concurrently
      const init1 = service.initialize();
      const init2 = service.initialize();
      const init3 = service.initialize();

      // All should complete without error
      await Promise.all([init1, init2, init3]);

      expect(service.isReady()).toBe(true);
    }, 60000);
  });

  describe('error handling', () => {
    test('should throw EmbeddingError on generation failure', async () => {
      // Create a service and force it to be initialized with a broken pipeline
      const service = new EmbeddingService();
      await service.initialize();

      // Mock the internal pipeline to fail on next call
      const originalPipeline = (service as any).pipeline;
      (service as any).pipeline = jest.fn().mockRejectedValue(new Error('Pipeline execution failed'));

      await expect(service.generateEmbedding('test')).rejects.toThrow('Failed to generate embedding');
      await expect(service.generateEmbedding('test')).rejects.toThrow(EmbeddingError);

      // Restore
      (service as any).pipeline = originalPipeline;
    }, 60000);

    test('should throw EmbeddingError on batch generation failure', async () => {
      const service = new EmbeddingService();
      await service.initialize();

      // Mock the internal pipeline to fail
      const originalPipeline = (service as any).pipeline;
      (service as any).pipeline = jest.fn().mockRejectedValue(new Error('Batch processing failed'));

      await expect(service.generateEmbeddings(['test1', 'test2'])).rejects.toThrow('Failed to generate embeddings');
      await expect(service.generateEmbeddings(['test1', 'test2'])).rejects.toThrow(EmbeddingError);

      // Restore
      (service as any).pipeline = originalPipeline;
    }, 60000);

    test('should handle generateEmbedding called before initialization', async () => {
      const service = new EmbeddingService();

      // Call generateEmbedding without calling initialize first
      // It should auto-initialize
      const embedding = await service.generateEmbedding('auto-init test');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
      expect(service.isReady()).toBe(true);
    }, 60000);

    test('should handle generateEmbeddings called before initialization', async () => {
      const service = new EmbeddingService();

      // Call generateEmbeddings without calling initialize first
      // It should auto-initialize
      const embeddings = await service.generateEmbeddings(['auto-init test 1', 'auto-init test 2']);

      expect(embeddings.length).toBe(2);
      embeddings.forEach((embedding) => {
        expect(embedding).toBeInstanceOf(Float32Array);
        expect(embedding.length).toBe(384);
      });
      expect(service.isReady()).toBe(true);
    }, 60000);

    test('should include original error details in EmbeddingError', async () => {
      const service = new EmbeddingService();
      await service.initialize();

      const testError = new Error('Original pipeline error with details');
      (service as any).pipeline = jest.fn().mockRejectedValue(testError);

      try {
        await service.generateEmbedding('test');
        fail('Should have thrown EmbeddingError');
      } catch (error) {
        expect(error).toBeInstanceOf(EmbeddingError);
        expect((error as EmbeddingError).message).toContain('Failed to generate embedding');
        expect((error as EmbeddingError).message).toContain('Original pipeline error with details');
        // Verify the original error is preserved
        expect((error as EmbeddingError).details).toBe(testError);
      }
    }, 60000);
  });
});
