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
});
