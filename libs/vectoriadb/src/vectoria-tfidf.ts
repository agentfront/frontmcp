import { TFIDFEmbeddingService } from './tfidf.embedding.service';
import type { DocumentMetadata, SearchOptions, SearchResult } from './interfaces';

/**
 * Document with TF-IDF sparse vector representation
 */
export interface TFIDFDocument<T extends DocumentMetadata = DocumentMetadata> {
  /**
   * Unique identifier for this document
   */
  id: string;

  /**
   * Sparse TF-IDF vector representation
   */
  vector: Map<string, number>;

  /**
   * Associated metadata
   */
  metadata: T;

  /**
   * Original text used to generate the embedding
   */
  text: string;

  /**
   * Timestamp when this document was created
   */
  createdAt: Date;
}

/**
 * Configuration for TF-IDF based VectoriaDB
 */
export interface TFIDFVectoriaConfig {
  /**
   * Default similarity threshold for search results
   * @default 0.0
   */
  defaultSimilarityThreshold?: number;

  /**
   * Maximum number of results to return by default
   * @default 10
   */
  defaultTopK?: number;
}

/**
 * Lightweight TF-IDF based vector database
 *
 * A synchronous, zero-dependency alternative to the ML-based VectoriaDB
 * Perfect for:
 * - Small to medium corpora (< 10K documents)
 * - Scenarios where ML model downloads are not acceptable
 * - Use cases requiring synchronous operation
 * - Keyword/term-based semantic search
 *
 * Limitations compared to ML-based VectoriaDB:
 * - Less semantic understanding (synonyms, context)
 * - Better for exact term matching
 * - Requires reindexing when corpus changes
 *
 * @example
 * ```ts
 * const db = new TFIDFVectoria<{ appId: string }>();
 *
 * // Add documents
 * db.addDocument('tool1', 'User authentication tool', { appId: 'auth', id: 'tool1' });
 * db.addDocument('tool2', 'User profile retrieval', { appId: 'user', id: 'tool2' });
 *
 * // Reindex after adding documents
 * db.reindex();
 *
 * // Search
 * const results = db.search('authentication', { topK: 5 });
 * ```
 */
export class TFIDFVectoria<T extends DocumentMetadata = DocumentMetadata> {
  private documents: Map<string, TFIDFDocument<T>>;
  private embeddingService: TFIDFEmbeddingService;
  private config: Required<TFIDFVectoriaConfig>;
  private needsReindex = false;

  constructor(config: TFIDFVectoriaConfig = {}) {
    this.documents = new Map();
    this.embeddingService = new TFIDFEmbeddingService();

    this.config = {
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.0,
      defaultTopK: config.defaultTopK ?? 10,
    };
  }

  /**
   * Add a document to the database
   * Note: You must call reindex() after adding documents for the IDF to be updated
   */
  addDocument(id: string, text: string, metadata: T): void {
    this.documents.set(id, {
      id,
      vector: new Map(), // Will be computed during reindex
      metadata,
      text,
      createdAt: new Date(),
    });

    this.needsReindex = true;
  }

  /**
   * Add multiple documents in batch
   * Note: You must call reindex() after adding documents for the IDF to be updated
   */
  addDocuments(documents: Array<{ id: string; text: string; metadata: T }>): void {
    for (const doc of documents) {
      this.documents.set(doc.id, {
        id: doc.id,
        vector: new Map(),
        metadata: doc.metadata,
        text: doc.text,
        createdAt: new Date(),
      });
    }

    this.needsReindex = true;
  }

  /**
   * Remove a document from the database
   * Note: You must call reindex() after removing documents for the IDF to be updated
   */
  removeDocument(id: string): boolean {
    const deleted = this.documents.delete(id);
    if (deleted) {
      this.needsReindex = true;
    }
    return deleted;
  }

  /**
   * Get a document by ID
   */
  getDocument(id: string): TFIDFDocument<T> | undefined {
    return this.documents.get(id);
  }

  /**
   * Check if a document exists
   */
  hasDocument(id: string): boolean {
    return this.documents.has(id);
  }

  /**
   * Get all document IDs
   */
  getAllDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get total number of documents
   */
  getDocumentCount(): number {
    return this.documents.size;
  }

  /**
   * Rebuild the IDF values and embeddings for all documents
   * Must be called after adding/removing documents
   */
  reindex(): void {
    if (!this.needsReindex) return;

    const documentTexts: string[][] = [];
    const entries = Array.from(this.documents.values());

    // Tokenize all documents
    for (const entry of entries) {
      documentTexts.push(this.embeddingService.tokenize(entry.text));
    }

    // Update IDF values
    this.embeddingService.updateIDF(documentTexts);

    // Recompute vectors for all documents
    for (const entry of entries) {
      entry.vector = this.embeddingService.embed(entry.text);
    }

    this.needsReindex = false;
  }

  /**
   * Check if reindexing is needed
   */
  needsReindexing(): boolean {
    return this.needsReindex;
  }

  /**
   * Search for documents matching the query
   */
  search(query: string, options: SearchOptions<T> = {}): SearchResult<T>[] {
    const { topK = this.config.defaultTopK, threshold = this.config.defaultSimilarityThreshold, filter } = options;

    // Reindex if needed
    if (this.needsReindex) {
      this.reindex();
    }

    // Generate query vector
    const queryVector = this.embeddingService.embed(query);

    const results: SearchResult<T>[] = [];

    // Compute similarity for each document
    for (const doc of this.documents.values()) {
      // Apply metadata filter if provided
      if (filter && !filter(doc.metadata)) {
        continue;
      }

      // Compute similarity
      const score = this.embeddingService.cosineSimilarity(queryVector, doc.vector);

      if (score >= threshold) {
        results.push({
          id: doc.id,
          metadata: doc.metadata,
          score,
          text: doc.text,
        });
      }
    }

    // Sort by score (descending) and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Clear all documents and reset the index
   */
  clear(): void {
    this.documents.clear();
    this.embeddingService.clear();
    this.needsReindex = false;
  }

  /**
   * Get statistics about the database
   */
  getStats(): {
    documentCount: number;
    vocabularySize: number;
    needsReindex: boolean;
  } {
    return {
      documentCount: this.documents.size,
      vocabularySize: this.embeddingService.getVocabularySize(),
      needsReindex: this.needsReindex,
    };
  }
}
