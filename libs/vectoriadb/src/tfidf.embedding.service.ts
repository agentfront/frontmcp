/**
 * Lightweight TF-IDF based embedding service for semantic search
 *
 * This provides a simple, synchronous alternative to the ML-based EmbeddingService
 * Ideal for use cases where:
 * - You don't want to download ML models
 * - You need synchronous operation
 * - You have a small to medium corpus (< 10K documents)
 * - You want zero external dependencies beyond Node.js
 *
 * Note: For production semantic search with larger corpora, use the ML-based
 * EmbeddingService which provides better quality embeddings via transformers.js
 */
export class TFIDFEmbeddingService {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private documentCount = 0;

  /**
   * Tokenizes and normalizes text into terms
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 1); // Filter out single characters
  }

  /**
   * Computes term frequency for a document
   */
  private computeTermFrequency(terms: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    const totalTerms = terms.length;

    // Handle empty document edge case
    if (totalTerms === 0) {
      return tf;
    }

    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }

    // Normalize by document length
    for (const [term, count] of tf.entries()) {
      tf.set(term, count / totalTerms);
    }

    return tf;
  }

  /**
   * Updates the IDF (Inverse Document Frequency) values
   * This should be called whenever documents are added to the corpus
   */
  updateIDF(documents: string[][]): void {
    this.documentCount = documents.length;
    const documentFrequency = new Map<string, number>();

    // Count how many documents contain each term
    for (const terms of documents) {
      const uniqueTerms = new Set(terms);
      for (const term of uniqueTerms) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
      }
    }

    // Compute IDF: log(N / df)
    for (const [term, df] of documentFrequency.entries()) {
      this.idf.set(term, Math.log(this.documentCount / df));
    }

    // Build vocabulary
    let index = 0;
    for (const term of this.idf.keys()) {
      if (!this.vocabulary.has(term)) {
        this.vocabulary.set(term, index++);
      }
    }
  }

  /**
   * Generates a TF-IDF vector for a given text
   * Returns a sparse vector representation as a Map<term, weight>
   */
  embed(text: string): Map<string, number> {
    const terms = this.tokenize(text);
    const tf = this.computeTermFrequency(terms);
    const vector = new Map<string, number>();

    for (const [term, tfValue] of tf.entries()) {
      const idfValue = this.idf.get(term) || 0;
      if (idfValue > 0) {
        vector.set(term, tfValue * idfValue);
      }
    }

    return vector;
  }

  /**
   * Converts a sparse vector to a dense Float32Array
   * Uses the internal vocabulary for dimension mapping
   * Missing terms are filled with zeros
   */
  toDenseVector(sparseVector: Map<string, number>): Float32Array {
    const dimensions = this.vocabulary.size;
    const dense = new Float32Array(dimensions);

    for (const [term, weight] of sparseVector.entries()) {
      const index = this.vocabulary.get(term);
      if (index !== undefined) {
        dense[index] = weight;
      }
    }

    return dense;
  }

  /**
   * Computes cosine similarity between two sparse vectors
   * More efficient than converting to dense vectors for TF-IDF
   */
  cosineSimilarity(vector1: Map<string, number>, vector2: Map<string, number>): number {
    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    // Compute dot product and magnitude of vector1
    for (const [term, value] of vector1.entries()) {
      magnitude1 += value * value;
      const value2 = vector2.get(term) || 0;
      dotProduct += value * value2;
    }

    // Compute magnitude of vector2
    for (const value of vector2.values()) {
      magnitude2 += value * value;
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Get the size of the vocabulary
   */
  getVocabularySize(): number {
    return this.vocabulary.size;
  }

  /**
   * Get the number of documents in the corpus
   */
  getDocumentCount(): number {
    return this.documentCount;
  }

  /**
   * Clear the IDF and vocabulary (useful for rebuilding the index)
   */
  clear(): void {
    this.vocabulary.clear();
    this.idf.clear();
    this.documentCount = 0;
  }
}
