import type { ToolData } from './vector-db.interface';

/**
 * Service for generating embeddings using transformers.js
 */
export class EmbeddingService {
  private model: any = null;
  private pipeline: any = null;
  private modelName: string;
  private dimensions: number = 384; // default for all-MiniLM-L6-v2
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(modelName: string = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  /**
   * Initialize the embedding model
   */
  async initialize(): Promise<void> {
    // Prevent multiple initializations
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._initialize();
    return this.initializationPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      // Dynamically import transformers.js to avoid bundling issues
      const { pipeline } = await import('@huggingface/transformers');

      // Create feature extraction pipeline
      this.pipeline = await pipeline('feature-extraction', this.modelName, {
        // Use local models directory to cache models
        cache_dir: './.cache/transformers',
        // Don't require progress bars in production
        progress_callback: null,
      });

      // Test the pipeline to get dimensions
      const testEmbedding = await this.pipeline('test', {
        pooling: 'mean',
        normalize: true,
      });

      this.dimensions = testEmbedding.data.length;
      this.isInitialized = true;
    } catch (error) {
      this.initializationPromise = null;
      throw new Error(
        `Failed to initialize embedding model: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      return new Float32Array(output.data);
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Process in batches to avoid memory issues
      const batchSize = 32;
      const results: Float32Array[] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const outputs = await Promise.all(
          batch.map((text) =>
            this.pipeline(text, {
              pooling: 'mean',
              normalize: true,
            }),
          ),
        );

        results.push(...outputs.map((output) => new Float32Array(output.data)));
      }

      return results;
    } catch (error) {
      throw new Error(`Failed to generate embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Convert tool data to searchable text
   */
  toolToText(tool: ToolData): string {
    const parts: string[] = [];

    // Add name (highest weight)
    if (tool.name) {
      parts.push(`Tool: ${tool.name}`);
    }

    // Add description
    if (tool.description) {
      parts.push(`Description: ${tool.description}`);
    }

    // Add input schema information
    if (tool.inputSchema) {
      const inputInfo = this.schemaToText(tool.inputSchema, 'Input');
      if (inputInfo) {
        parts.push(inputInfo);
      }
    }

    // Add output schema information
    if (tool.outputSchema) {
      const outputInfo = this.schemaToText(tool.outputSchema, 'Output');
      if (outputInfo) {
        parts.push(outputInfo);
      }
    }

    // Add tags
    if (tool.tags && tool.tags.length > 0) {
      parts.push(`Tags: ${tool.tags.join(', ')}`);
    }

    return parts.join('. ');
  }

  /**
   * Convert JSON Schema to readable text
   */
  private schemaToText(schema: any, prefix: string): string {
    if (!schema) return '';

    const parts: string[] = [];

    if (typeof schema === 'string') {
      return `${prefix}: ${schema}`;
    }

    if (typeof schema === 'object') {
      // Handle JSON Schema
      if (schema.type === 'object' && schema.properties) {
        const fields = Object.entries(schema.properties)
          .map(([key, value]: [string, any]) => {
            const description = value.description || key;
            return description;
          })
          .join(', ');

        if (fields) {
          parts.push(`${prefix} fields: ${fields}`);
        }
      } else if (schema.description) {
        parts.push(`${prefix}: ${schema.description}`);
      } else if (schema.title) {
        parts.push(`${prefix}: ${schema.title}`);
      }
    }

    return parts.join('. ');
  }

  /**
   * Get the vector dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Get the model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}
