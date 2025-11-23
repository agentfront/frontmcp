/**
 * Jest setup file for vectoria tests
 * Mocks the transformers.js library to avoid ONNX Runtime issues in test environment
 */

// Mock the transformers pipeline
jest.mock('@huggingface/transformers', () => {
  // Helper to extract and normalize words from text
  const extractWords = (text: string): string[] => {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2); // Filter out short words like "a", "an", "in"
  };

  // Normalize word forms to their root (simple stemming)
  const normalizeWord = (word: string): string => {
    // Simple stemming - remove common suffixes
    return word.replace(/ing$/, '').replace(/s$/, '').replace(/ed$/, '').replace(/er$/, '');
  };

  // Create a mock pipeline function that returns consistent embeddings
  const createMockPipeline = () => {
    return async (text: string | string[]) => {
      const textStr = text.toString();
      const words = extractWords(textStr);
      const normalizedWords = words.map(normalizeWord);

      // Create a 384-dimensional embedding (matching all-MiniLM-L6-v2)
      const embedding = new Float32Array(384);

      // Each normalized word contributes to specific dimensions
      // This ensures that texts with overlapping words have high similarity
      normalizedWords.forEach((word) => {
        // Calculate which dimensions this word affects
        const wordHash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);

        // Each word contributes to ~50 dimensions centered around its hash position
        for (let offset = -25; offset < 25; offset++) {
          const dim = (wordHash + offset) % 384;
          // Use Gaussian-like contribution
          const contribution = Math.exp(-(offset * offset) / 100);
          embedding[dim] += contribution;
        }
      });

      // Add small random-like component for uniqueness
      for (let i = 0; i < 384; i++) {
        // Deterministic "noise" based on text length and position
        const noise = Math.sin(textStr.length * 100 + i) * 0.01;
        embedding[i] += noise;
      }

      // Normalize the embedding to unit length (as transformers.js does)
      let norm = 0;
      for (let i = 0; i < embedding.length; i++) {
        norm += embedding[i] * embedding[i];
      }
      norm = Math.sqrt(norm);

      if (norm > 0) {
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] /= norm;
        }
      }

      return {
        data: embedding,
      };
    };
  };

  return {
    pipeline: jest.fn(async () => {
      return createMockPipeline();
    }),
  };
});
