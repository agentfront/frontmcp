// file: libs/plugins/src/codecall/services/tool-search.service.ts

import { ToolEntry, ScopeEntry } from '@frontmcp/sdk';
import { TFIDFVectoria, VectoriaDB, DocumentMetadata } from 'vectoriadb';
import type {
  EmbeddingStrategy,
  CodeCallEmbeddingOptions,
  CodeCallMode,
  CodeCallToolMetadata,
} from '../codecall.types';
import type {
  ToolSearch,
  ToolSearchResult as SymbolToolSearchResult,
  ToolSearchOptions as SymbolToolSearchOptions,
} from '../codecall.symbol';
import { SynonymExpansionService, SynonymExpansionConfig } from './synonym-expansion.service';

/**
 * Universal Intent Mapping & Query Normalization
 * - This module defines the semantic knowledge base for the MCP tool search engine.
 *   It is designed to bridge the gap between natural language user intents
 *   (e.g., "fix," "chat," "buy") and technical tool definitions (e.g., "update," "post," "create").
 * - Key Parts:
 *   1. DEFAULT_SYNONYM_GROUPS: A domain-agnostic mapping of bidirectional synonyms covering
 *      CRUD, DevOps, Financial, Social, and Lifecycle operations. This ensures that a
 *      query for "Show me the bill" matches a tool named "get_invoice".
 *   2. STOP_WORDS: A curated exclusion list strictly optimized for Command-Line/Chat
 *      interfaces. Unlike standard NLP stop lists, this PRESERVES action verbs
 *      ("find", "start", "make") as they are critical signals of user intent in a
 *      tool-execution context.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // Articles & Determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',

  // Prepositions
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'about',
  'against',
  'during',
  'through',

  // Conjunctions
  'and',
  'or',
  'but',
  'nor',
  'so',
  'yet',
  'as',
  'than',
  'if',
  'because',
  'while',
  'when',
  'where',
  'unless',

  // Pronouns (Subject/Object/Possessive)
  'i',
  'me',
  'my',
  'mine',
  'myself',
  'you',
  'your',
  'yours',
  'yourself',
  'he',
  'him',
  'his',
  'himself',
  'she',
  'her',
  'hers',
  'herself',
  'it',
  'its',
  'itself',
  'we',
  'us',
  'our',
  'ours',
  'ourselves',
  'they',
  'them',
  'their',
  'theirs',
  'themselves',
  'who',
  'whom',
  'whose',
  'which',
  'what',

  // Auxiliary/Linking Verbs (State of being is usually noise, Action is signal)
  'is',
  'was',
  'are',
  'were',
  'been',
  'be',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'doing', // "do" is usually auxiliary ("do you have..."). "run" or "execute" is better.
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',

  // Quantifiers / Adverbs of degree
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'too',
  'very',
  'just',
  'even',

  // Conversational / Chat Fillers (Common in LLM prompts)
  'please',
  'pls',
  'plz',
  'thanks',
  'thank',
  'thx',
  'hello',
  'hi',
  'hey',
  'ok',
  'okay',
  'yes',
  'no',
  'actually',
  'basically',
  'literally',
  'maybe',
  'perhaps',
  'now',
  'then',
  'here',
  'there',
  'again',
  'once',
  'back', // "back" can be tricky, but usually implies direction not action

  // Meta/Structural words
  'example',
  'context',
  'optionally',
  'optional', // Users rarely search for "optional", they search for the thing itself.
  'etc',
  'ie',
  'eg',
]);
/**
 * Metadata structure for tool documents in the vector database
 */
// NOTE: `any` is intentional - ToolEntry has constrained generics that don't work with `unknown`
interface ToolMetadata extends DocumentMetadata {
  id: string;
  toolName: string;
  qualifiedName: string;
  appId?: string;
  toolInstance: ToolEntry<any, any>;
}

/**
 * Search result for tool search
 */
// NOTE: `any` is intentional - ToolEntry has constrained generics that don't work with `unknown`
export interface SearchResult {
  tool: ToolEntry<any, any>;
  score: number;
  toolName: string;
  qualifiedName: string;
  appId?: string;
}

/**
 * Search options for tool search
 */
export interface SearchOptions {
  topK?: number;
  appIds?: string[];
  excludeToolNames?: string[];
  minScore?: number;
}

/**
 * Filter function type for including tools
 */
export type IncludeToolsFilter = (info: {
  name: string;
  appId?: string;
  source?: string;
  description?: string;
  tags?: string[];
}) => boolean;

/**
 * Configuration for tool search service
 */
export interface ToolSearchServiceConfig {
  /**
   * Embedding strategy to use
   * @default 'tfidf'
   */
  strategy?: EmbeddingStrategy;

  /**
   * Full embedding options (alternative to just strategy)
   */
  embeddingOptions?: CodeCallEmbeddingOptions;

  /**
   * Default number of results to return
   * @default 8
   */
  defaultTopK?: number;

  /**
   * Default similarity threshold
   * @default 0.0
   */
  defaultSimilarityThreshold?: number;

  /**
   * CodeCall mode for filtering tools
   * @default 'codecall_only'
   */
  mode?: CodeCallMode;

  /**
   * Optional filter function for including tools in the search index
   */
  includeTools?: IncludeToolsFilter;

  /**
   * Synonym expansion configuration.
   * When enabled, queries are expanded with synonyms to improve search relevance.
   * For example, "add user" will also match tools containing "create user".
   * Only applies when strategy is 'tfidf' (ML already handles semantic similarity).
   *
   * Set to false to disable, or provide a config object to customize.
   * @default { enabled: true } when strategy is 'tfidf'
   */
  synonymExpansion?: false | (SynonymExpansionConfig & { enabled?: boolean });
}

/**
 * Service that maintains a searchable index of tools from the ToolRegistry
 * Supports both TF-IDF (lightweight, synchronous) and ML-based (semantic) embeddings
 * Implements the ToolSearch interface for dependency injection
 */
export class ToolSearchService implements ToolSearch {
  private static readonly MAX_SUBSCRIPTION_RETRIES = 100;
  private vectorDB: TFIDFVectoria<ToolMetadata> | VectoriaDB<ToolMetadata>;
  private strategy: EmbeddingStrategy;
  private initialized = false;
  private mlInitialized = false;
  private subscriptionRetries = 0;
  private config: Required<Omit<ToolSearchServiceConfig, 'includeTools' | 'mode' | 'synonymExpansion'>> & {
    mode: CodeCallMode;
    includeTools?: IncludeToolsFilter;
  };
  private scope: ScopeEntry;
  private unsubscribe?: () => void;
  private synonymService: SynonymExpansionService | null = null;

  constructor(config: ToolSearchServiceConfig = {}, scope: ScopeEntry) {
    this.scope = scope;
    const embeddingOptions: CodeCallEmbeddingOptions = config.embeddingOptions || {
      strategy: 'tfidf',
      modelName: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: './.cache/transformers',
      useHNSW: false,
      synonymExpansion: { enabled: true, replaceDefaults: false, maxExpansionsPerTerm: 5 },
    };
    this.strategy = config.strategy || embeddingOptions.strategy || 'tfidf';

    this.config = {
      strategy: this.strategy,
      embeddingOptions,
      defaultTopK: config.defaultTopK ?? 8,
      defaultSimilarityThreshold: config.defaultSimilarityThreshold ?? 0.0,
      mode: config.mode ?? 'codecall_only',
      includeTools: config.includeTools,
    };

    // Validate mode parameter at runtime
    const validModes = ['codecall_only', 'codecall_opt_in', 'metadata_driven'] as const;
    if (!validModes.includes(this.config.mode as (typeof validModes)[number])) {
      throw new Error(`Invalid CodeCall mode: ${this.config.mode}. Valid modes: ${validModes.join(', ')}`);
    }

    // Initialize the appropriate vector database
    if (this.strategy === 'ml') {
      this.vectorDB = new VectoriaDB<ToolMetadata>({
        modelName: embeddingOptions.modelName || 'Xenova/all-MiniLM-L6-v2',
        cacheDir: embeddingOptions.cacheDir || './.cache/transformers',
        defaultTopK: this.config.defaultTopK,
        defaultSimilarityThreshold: this.config.defaultSimilarityThreshold,
        useHNSW: embeddingOptions.useHNSW || false,
      });
    } else {
      this.vectorDB = new TFIDFVectoria<ToolMetadata>({
        defaultTopK: this.config.defaultTopK,
        defaultSimilarityThreshold: this.config.defaultSimilarityThreshold,
      });
    }

    // Initialize synonym expansion for TF-IDF strategy (ML already handles semantic similarity)
    if (config.synonymExpansion === false) {
      this.synonymService = null;
    } else if (this.strategy === 'tfidf') {
      const synonymConfig = typeof config.synonymExpansion === 'object' ? config.synonymExpansion : {};
      // Only enable if not explicitly disabled
      if (synonymConfig.enabled !== false) {
        this.synonymService = new SynonymExpansionService(synonymConfig);
      }
    }

    // Defer subscription until scope.tools is available
    // During plugin initialization, scope.tools may not exist yet
    this.setupSubscription();
  }

  /**
   * Sets up subscription to tool changes. Handles the case where scope.tools
   * may not be available yet during plugin initialization.
   */
  private setupSubscription(): void {
    // If tools registry is not yet available, retry after a microtask
    if (!this.scope.tools) {
      if (this.subscriptionRetries++ >= ToolSearchService.MAX_SUBSCRIPTION_RETRIES) {
        console.warn('ToolSearchService: scope.tools not available after max retries');
        return;
      }
      // Use queueMicrotask to defer until after current initialization
      // setTimeout(() => this.setupSubscription(), 100);
      queueMicrotask(() => this.setupSubscription());
      return;
    }
    // Reset retry counter on success
    this.subscriptionRetries = 0;

    // Subscribe to tool changes with immediate=true to get current snapshot
    // This ensures tools are indexed as they become available, regardless of loading order
    this.unsubscribe = this.scope.tools.subscribe({ immediate: true }, (event) => {
      // Handle tool change event - reindex all tools from the snapshot
      this.handleToolChange(event.snapshot as unknown as ToolEntry<any, any>[]);
    });
  }

  /**
   * Handles tool change events by reindexing all tools from the snapshot
   */
  private async handleToolChange(tools: ToolEntry<any, any>[]): Promise<void> {
    // Clear and rebuild index
    this.vectorDB.clear();

    if (tools.length === 0) {
      this.initialized = true;
      return;
    }

    // Initialize ML model if needed (first time only, and only when we have tools)
    // Deferred initialization avoids async operations when there's nothing to index
    if (!this.mlInitialized && this.strategy === 'ml' && this.vectorDB instanceof VectoriaDB) {
      await this.vectorDB.initialize();
      this.mlInitialized = true;
    }

    // Filter tools based on CodeCall config and per-tool metadata
    const filteredTools = tools.filter((tool) => this.shouldIndexTool(tool));

    if (filteredTools.length === 0) {
      this.initialized = true;
      return;
    }

    const documents = filteredTools.map((tool) => {
      const searchableText = this.extractSearchableText(tool);
      const appId = this.extractAppId(tool);
      const toolName = tool.name;
      const qualifiedName = tool.fullName || toolName;

      return {
        id: toolName,
        text: searchableText,
        metadata: {
          id: toolName,
          toolName,
          qualifiedName,
          appId,
          toolInstance: tool,
        },
      };
    });

    if (this.strategy === 'ml' && this.vectorDB instanceof VectoriaDB) {
      await this.vectorDB.addMany(documents);
    } else if (this.vectorDB instanceof TFIDFVectoria) {
      this.vectorDB.addDocuments(documents);
      this.vectorDB.reindex();
    }

    this.initialized = true;
  }

  /**
   * Determines if a tool should be indexed in the search database.
   * Filters based on:
   * - Excludes codecall:* meta-tools (they should not be searchable)
   * - Mode-based filtering (codecall_only, codecall_opt_in, metadata_driven)
   * - Per-tool metadata.codecall.enabledInCodeCall
   * - Custom includeTools filter function
   */
  private shouldIndexTool(tool: ToolEntry<any, any>): boolean {
    const toolName = tool.name || tool.fullName;

    // Never index codecall:* meta-tools - they are for orchestration, not for search
    if (toolName.startsWith('codecall:')) {
      return false;
    }

    // Get CodeCall-specific metadata from the tool
    const codecallMeta = this.getCodeCallMetadata(tool);

    // Apply mode-based filtering
    switch (this.config.mode) {
      case 'codecall_only':
        // In codecall_only mode, all non-codecall tools are searchable
        // unless explicitly disabled via metadata
        if (codecallMeta?.enabledInCodeCall === false) {
          return false;
        }
        break;

      case 'codecall_opt_in':
        // In opt_in mode, tools must explicitly opt-in via metadata
        if (codecallMeta?.enabledInCodeCall !== true) {
          return false;
        }
        break;

      case 'metadata_driven':
        // In metadata_driven mode, default to enabled unless explicitly disabled
        if (codecallMeta?.enabledInCodeCall === false) {
          return false;
        }
        break;

      default:
        // This should never happen due to constructor validation
        // but provides defense-in-depth and satisfies exhaustive checking
        throw new Error(`Unknown CodeCall mode: ${this.config.mode}`);
    }

    // Apply custom includeTools filter if provided
    if (this.config.includeTools) {
      const appId = this.extractAppId(tool);
      const filterInfo = {
        name: toolName,
        appId,
        source: codecallMeta?.source,
        description: tool.metadata.description,
        tags: codecallMeta?.tags || tool.metadata.tags,
      };

      if (!this.config.includeTools(filterInfo)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Extract CodeCall-specific metadata from a tool.
   */
  private getCodeCallMetadata(tool: ToolEntry<any, any>): CodeCallToolMetadata | undefined {
    // NOTE: `any` cast is intentional - ToolMetadata has constrained generics
    return (tool.metadata as any)?.codecall as CodeCallToolMetadata | undefined;
  }

  /**
   * Initializes the search service by indexing all tools from the registry.
   * NOTE: This method is now a no-op. Initialization is handled reactively
   * via subscription to tool change events in the constructor.
   * This method exists for interface compatibility.
   */
  async initialize(): Promise<void> {
    // Initialization is now handled reactively via subscription
    // The subscription with immediate=true in the constructor ensures tools are indexed
    // This method exists for interface compatibility
  }

  /**
   * Cleanup subscription when service is destroyed
   */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Extracts searchable text from a tool instance.
   * Uses term weighting to improve relevance:
   * - Description terms are heavily weighted (most important for semantic matching)
   * - Tool name parts are tokenized and weighted
   * - Tags provide additional context
   */
  private extractSearchableText(tool: ToolEntry<any, any>): string {
    const parts: string[] = [];

    // Extract and weight tool name parts
    // Split on common delimiters (: - _ .) to get meaningful tokens
    if (tool.name) {
      const nameParts = tool.name.split(/[:\-_.]/).filter(Boolean);
      // Add each part twice for moderate weighting
      for (const part of nameParts) {
        parts.push(part, part);
      }
    }

    // Description is the most important for semantic matching
    // Weight it heavily by repeating 3x
    if (tool.metadata.description) {
      const description = tool.metadata.description;
      parts.push(description, description, description);

      // Also extract key terms from description (words 4+ chars) for extra weight
      const keyTerms = description
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !this.isStopWord(word));
      parts.push(...keyTerms);
    }

    // Add tags with moderate weight (2x)
    if (tool.metadata.tags && tool.metadata.tags.length > 0) {
      for (const tag of tool.metadata.tags) {
        parts.push(tag, tag);
      }
    }

    // Add input schema property names (useful for parameter-based searches)
    if (tool.rawInputSchema && typeof tool.rawInputSchema === 'object') {
      const schema = tool.rawInputSchema as any;
      if (schema.properties) {
        parts.push(...Object.keys(schema.properties));
      }
    }

    // Add example descriptions and input values to searchable text
    // Examples help users find tools by use-case descriptions
    const examples = tool.metadata?.examples;
    if (examples && Array.isArray(examples)) {
      for (const ex of examples) {
        // Add example description (2x weight for relevance)
        if (ex.description) {
          parts.push(ex.description, ex.description);
        }
        // Add example input keys and string values
        if (ex.input && typeof ex.input === 'object') {
          for (const [key, value] of Object.entries(ex.input as Record<string, unknown>)) {
            parts.push(key);
            if (typeof value === 'string') {
              parts.push(value);
            }
          }
        }
      }
    }

    return parts.join(' ');
  }

  /**
   * Checks if a word is a common stop word that should not receive extra weighting.
   * Uses module-level STOP_WORDS constant to avoid recreating the Set on each call.
   */
  private isStopWord(word: string): boolean {
    return STOP_WORDS.has(word);
  }

  /**
   * Extracts app ID from tool's owner lineage
   */
  private extractAppId(tool: ToolEntry<any, any>): string | undefined {
    if (!tool.owner) return undefined;

    // The owner structure has kind and id
    if (tool.owner.kind === 'app') {
      return tool.owner.id;
    }

    // If the tool is owned by a plugin, we need to look at its parent scope
    // For now, we'll return undefined and rely on the lineage if needed
    return undefined;
  }

  /**
   * Searches for tools matching the query
   * Implements the ToolSearch interface
   */
  async search(query: string, options: SymbolToolSearchOptions = {}): Promise<SymbolToolSearchResult[]> {
    const { topK = this.config.defaultTopK, appIds, excludeToolNames = [] } = options;
    const minScore = this.config.defaultSimilarityThreshold;

    // Build filter function
    const filter = (metadata: ToolMetadata): boolean => {
      // Exclude tools
      if (excludeToolNames.includes(metadata.toolName)) {
        return false;
      }

      // Filter by appId if specified
      if (appIds && appIds.length > 0) {
        if (!metadata.appId || !appIds.includes(metadata.appId)) {
          return false;
        }
      }

      return true;
    };

    // Expand query with synonyms for TF-IDF strategy to improve relevance
    // For example: "add user" -> "add create new insert make user account member profile"
    const effectiveQuery = this.synonymService ? this.synonymService.expandQuery(query) : query;

    // Search using vectoriadb
    const results = await this.vectorDB.search(effectiveQuery, {
      topK,
      threshold: minScore,
      filter,
    });

    // Transform results to match the ToolSearch interface
    return results.map((result) => ({
      toolName: result.metadata.toolName,
      appId: result.metadata.appId,
      description: result.metadata.toolInstance.metadata.description || '',
      relevanceScore: result.score,
    }));
  }

  /**
   * Gets all indexed tool names
   */
  getAllToolNames(): string[] {
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.getAll().map((doc) => doc.id);
    } else {
      return this.vectorDB.getAllDocumentIds();
    }
  }

  /**
   * Gets the total number of indexed tools
   */
  getTotalCount(): number {
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.size();
    } else {
      return this.vectorDB.getDocumentCount();
    }
  }

  /**
   * Checks if a tool exists in the index
   */
  hasTool(toolName: string): boolean {
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.has(toolName);
    } else {
      return this.vectorDB.hasDocument(toolName);
    }
  }

  /**
   * Clears the entire index
   */
  clear(): void {
    this.vectorDB.clear();
    this.initialized = false;
  }

  /**
   * Get the current embedding strategy
   */
  getStrategy(): EmbeddingStrategy {
    return this.strategy;
  }

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
