import { EmbeddingService } from '../embedding.service';

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
    test('should handle empty string embedding', async () => {
      await embeddingService.initialize();

      const embedding = await embeddingService.generateEmbedding('');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle whitespace-only string', async () => {
      await embeddingService.initialize();

      const embedding = await embeddingService.generateEmbedding('   ');

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle very long text', async () => {
      await embeddingService.initialize();

      const longText = 'word '.repeat(1000); // 5000 characters
      const embedding = await embeddingService.generateEmbedding(longText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    }, 60000);

    test('should handle special characters', async () => {
      await embeddingService.initialize();

      const specialText = '!@#$%^&*()_+-={}[]|\\:";\'<>?,./`~';
      const embedding = await embeddingService.generateEmbedding(specialText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle unicode characters', async () => {
      await embeddingService.initialize();

      const unicodeText = '你好世界 🌍 مرحبا العالم';
      const embedding = await embeddingService.generateEmbedding(unicodeText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle emoji text', async () => {
      await embeddingService.initialize();

      const emojiText = '😀 😃 😄 😁 🎉 🎊 🎈';
      const embedding = await embeddingService.generateEmbedding(emojiText);

      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding.length).toBe(384);
    });

    test('should handle empty batch', async () => {
      await embeddingService.initialize();

      const embeddings = await embeddingService.generateEmbeddings([]);

      expect(embeddings).toEqual([]);
    });

    test('should handle batch with one item', async () => {
      await embeddingService.initialize();

      const embeddings = await embeddingService.generateEmbeddings(['single text']);

      expect(embeddings.length).toBe(1);
      expect(embeddings[0]).toBeInstanceOf(Float32Array);
      expect(embeddings[0].length).toBe(384);
    });

    test('should handle batch with mixed empty and non-empty strings', async () => {
      await embeddingService.initialize();

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
      await embeddingService.initialize();

      expect(embeddingService.getDimensions()).toBe(384);
    });

    test('should handle numbers as text', async () => {
      await embeddingService.initialize();

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
      const fs = require('fs/promises');
      try {
        await fs.rm(customCacheDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }, 60000);
  });
});
