// file: libs/plugins/src/codecall/services/tool-search.service.ts

import { TFIDFVectoria, VectoriaDB, type DocumentMetadata } from 'vectoriadb';

import { type ScopeEntry, type ToolEntry } from '@frontmcp/sdk';

import type {
  ToolSearchOptions as SymbolToolSearchOptions,
  ToolSearchResult as SymbolToolSearchResult,
  ToolSearch,
} from '../codecall.symbol';
import type {
  CodeCallEmbeddingOptions,
  CodeCallMode,
  EmbeddingStrategy,
  IncludeToolsFilterToolInfo,
} from '../codecall.types';
import {
  checkCodeCallToolPolicy,
  codeCallAppIdOf,
  isOfferedToCaller,
  toCodeCallPolicyTool,
} from '../security/codecall-tool-policy';
import { SynonymExpansionService, type SynonymExpansionConfig } from './synonym-expansion.service';

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

const DEFAULT_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

/** A tool as the search index holds it. */
interface ToolDocument {
  id: string;
  text: string;
  metadata: ToolMetadata;
}

/** Where a tool is offered (`availableWhen`), checked against the caller's surface. */
type ToolAvailability = { surface?: readonly string[] } | undefined;

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
export type IncludeToolsFilter = (info: IncludeToolsFilterToolInfo) => boolean;

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
  private static readonly INITIAL_RETRY_DELAY_MS = 10;
  private static readonly MAX_RETRY_DELAY_MS = 1000;

  private vectorDB: TFIDFVectoria<ToolMetadata> | VectoriaDB<ToolMetadata>;
  private strategy: EmbeddingStrategy;
  private initialized = false;
  private mlInitialized = false;
  private config: Required<Omit<ToolSearchServiceConfig, 'includeTools' | 'mode' | 'synonymExpansion'>> & {
    mode: CodeCallMode;
    includeTools?: IncludeToolsFilter;
  };
  private scope: ScopeEntry;
  private unsubscribe?: () => void;
  private synonymService: SynonymExpansionService | null = null;
  private readonly synonymExpansion: ToolSearchServiceConfig['synonymExpansion'];
  /** The reindex in progress: later tool changes queue behind it and `search()` waits for it. */
  private indexing?: Promise<void>;

  // Subscription tracking for async initialization
  private subscriptionPromise: Promise<void>;
  private subscriptionResolved = false;
  private subscriptionResolve: (() => void) | null = null;
  private subscriptionReject: ((reason?: Error) => void) | null = null;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** `availableWhen` of each indexed tool, by indexed name, for per-caller surface filtering. */
  private availabilityByTool = new Map<string, ToolAvailability>();

  constructor(config: ToolSearchServiceConfig = {}, scope: ScopeEntry) {
    this.scope = scope;
    const embeddingOptions: CodeCallEmbeddingOptions = config.embeddingOptions || {
      strategy: 'tfidf',
      modelName: DEFAULT_EMBEDDING_MODEL,
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
        modelName: embeddingOptions.modelName || DEFAULT_EMBEDDING_MODEL,
        cacheDir: embeddingOptions.cacheDir || './.cache/transformers',
        defaultTopK: this.config.defaultTopK,
        defaultSimilarityThreshold: this.config.defaultSimilarityThreshold,
        useHNSW: embeddingOptions.useHNSW || false,
      });
    } else {
      this.vectorDB = this.createTfidfIndex();
    }

    // Initialize synonym expansion for TF-IDF strategy (ML already handles semantic similarity)
    this.synonymExpansion = config.synonymExpansion ?? embeddingOptions.synonymExpansion;
    if (this.strategy === 'tfidf') {
      this.synonymService = this.createSynonymService();
    }

    // Create subscription promise - resolves when subscribed to tool changes, rejects on disposal
    this.subscriptionPromise = new Promise<void>((resolve, reject) => {
      this.subscriptionResolve = resolve;
      this.subscriptionReject = reject;
    });

    // Initiate subscription setup (non-blocking)
    // During plugin initialization, scope.tools may not exist yet
    this.setupSubscription();
  }

  private createTfidfIndex(): TFIDFVectoria<ToolMetadata> {
    return new TFIDFVectoria<ToolMetadata>({
      defaultTopK: this.config.defaultTopK,
      defaultSimilarityThreshold: this.config.defaultSimilarityThreshold,
    });
  }

  private createSynonymService(): SynonymExpansionService | null {
    const synonymExpansion = this.synonymExpansion;
    if (synonymExpansion === false || synonymExpansion?.enabled === false) return null;
    return new SynonymExpansionService(synonymExpansion ?? {});
  }

  /**
   * Ensures the service is subscribed to tool changes before proceeding.
   * Public methods should call this before accessing tools.
   */
  private async ensureSubscribed(): Promise<void> {
    if (this.subscriptionResolved) {
      return; // Already subscribed
    }
    await this.subscriptionPromise;
  }

  /**
   * Sets up subscription to tool changes with exponential backoff retry.
   * Handles the case where scope.tools may not be available yet during plugin initialization.
   */
  private setupSubscription(retryCount = 0, delayMs = ToolSearchService.INITIAL_RETRY_DELAY_MS): void {
    // If tools registry is available, subscribe immediately
    if (this.scope.tools) {
      this.subscribeToToolChanges();
      return;
    }

    // Max retries exceeded
    if (retryCount >= ToolSearchService.MAX_SUBSCRIPTION_RETRIES) {
      this.scope.logger.warn(
        'ToolSearchService: scope.tools not available after max retries. ' +
          'Tool search will return incomplete results until tools are registered.',
      );
      // Resolve the promise anyway to prevent indefinite blocking
      this.markSubscribed();
      return;
    }

    // Retry with exponential backoff using setTimeout
    // Unlike queueMicrotask, setTimeout waits for actual event loop ticks,
    // allowing async operations (like adapter index pulling) to complete
    const nextDelay = Math.min(delayMs * 2, ToolSearchService.MAX_RETRY_DELAY_MS);
    this.retryTimeoutId = setTimeout(() => {
      this.retryTimeoutId = null;
      // Check if service was disposed during the timeout to prevent continuing after disposal
      if (this.disposed) {
        return;
      }
      this.setupSubscription(retryCount + 1, nextDelay);
    }, delayMs);
  }

  /**
   * Subscribes to tool changes once scope.tools is available.
   */
  private subscribeToToolChanges(): void {
    // Subscribe to tool changes with immediate=true to get current snapshot
    // This ensures tools are indexed as they become available, regardless of loading order
    this.unsubscribe = this.scope.tools.subscribe({ immediate: true }, (event) => {
      // Handle tool change event - reindex all tools from the snapshot
      this.queueReindex(event.snapshot as unknown as ToolEntry<any, any>[]);
    });
    this.markSubscribed();
  }

  /** Reindex from `tools` once the reindex in progress (if any) is done; a failure is logged, never thrown. */
  private queueReindex(tools: ToolEntry<any, any>[]): void {
    const reindex = () => this.handleToolChange(tools);
    const run = (this.indexing ? this.indexing.then(reindex) : reindex()).catch((error: unknown) => {
      this.scope.logger.warn(`CodeCall tool search could not index the tools: ${messageOf(error)}`);
    });
    this.indexing = run;
    void run.then(() => {
      if (this.indexing === run) this.indexing = undefined;
    });
  }

  /**
   * Marks the subscription as resolved, allowing pending operations to proceed.
   */
  private markSubscribed(): void {
    this.subscriptionResolved = true;
    if (this.subscriptionResolve) {
      this.subscriptionResolve();
      this.subscriptionResolve = null;
    }
  }

  /**
   * Handles tool change events by reindexing all tools from the snapshot. The new index replaces the
   * current one only once it is built, and a tool that can't be read is skipped, so the other tools
   * stay searchable.
   */
  private async handleToolChange(tools: ToolEntry<any, any>[]): Promise<void> {
    // Initialize ML model if needed (first time only, and only when we have tools)
    // Deferred initialization avoids async operations when there's nothing to index
    if (tools.length > 0 && !this.mlInitialized && this.strategy === 'ml' && this.vectorDB instanceof VectoriaDB) {
      try {
        await this.vectorDB.initialize();
        this.mlInitialized = true;
      } catch (error) {
        this.fallBackToTfidf(error);
      }
    }

    const availabilityByTool = new Map<string, ToolAvailability>();
    const documents = tools.flatMap((tool) => this.toDocuments(tool, availabilityByTool));
    await this.replaceIndex(documents);
    this.availabilityByTool = availabilityByTool;
    this.initialized = true;
  }

  /** The tool's search document, or none when CodeCall may not execute it or it can't be read. */
  private toDocuments(tool: ToolEntry<any, any>, availabilityByTool: Map<string, ToolAvailability>): ToolDocument[] {
    try {
      if (!this.shouldIndexTool(tool)) return [];
      const toolName = tool.name;
      const document: ToolDocument = {
        id: toolName,
        text: this.extractSearchableText(tool),
        metadata: {
          id: toolName,
          toolName,
          qualifiedName: tool.fullName || toolName,
          appId: this.extractAppId(tool),
          toolInstance: tool,
        },
      };
      availabilityByTool.set(toolName, tool.metadata.availableWhen);
      return [document];
    } catch (error) {
      this.scope.logger.warn(`CodeCall tool search skipped tool "${tool.name}": ${messageOf(error)}`);
      return [];
    }
  }

  /** Index `documents` in place of the current contents; embeddings that fail fall back to TF-IDF. */
  private async replaceIndex(documents: ToolDocument[]): Promise<void> {
    if (this.vectorDB instanceof VectoriaDB) {
      try {
        this.vectorDB.clear();
        if (documents.length > 0) await this.vectorDB.addMany(documents);
        return;
      } catch (error) {
        this.fallBackToTfidf(error);
      }
    }
    const index = this.createTfidfIndex();
    index.addDocuments(documents);
    index.reindex();
    this.vectorDB = index;
  }

  /** The embedding model could not be loaded or used: search with TF-IDF for the rest of the process. */
  private fallBackToTfidf(error: unknown): void {
    const modelName = this.config.embeddingOptions.modelName || DEFAULT_EMBEDDING_MODEL;
    this.scope.logger.warn(
      `CodeCall could not use embedding model "${modelName}" (${messageOf(error)}); tool search uses TF-IDF instead`,
    );
    this.strategy = 'tfidf';
    this.vectorDB = this.createTfidfIndex();
    this.synonymService = this.createSynonymService();
  }

  /**
   * Whether a tool belongs in the search index: exactly when CodeCall may execute it.
   * The decision is `codecall:execute`'s own, so search cannot show a tool execution refuses
   * or hide one it runs (GHSA-6w3j-82v5-6qrr).
   */
  private shouldIndexTool(tool: ToolEntry<any, any>): boolean {
    return checkCodeCallToolPolicy(toCodeCallPolicyTool(tool, undefined, this.scope), this.config).allowed;
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
   * Cleanup subscription and pending retries when service is destroyed
   */
  dispose(): void {
    // Mark as disposed to prevent any further callbacks or operations
    this.disposed = true;

    // Clear any pending retry timeout to prevent callbacks after disposal
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }

    // Reject the subscription promise if it hasn't resolved yet
    // This prevents callers from waiting indefinitely on a disposed service
    if (this.subscriptionReject) {
      this.subscriptionReject(new Error('ToolSearchService disposed before subscription completed'));
      this.subscriptionReject = null;
      this.subscriptionResolve = null;
    }

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
    // The same app the policy's `includeTools` filter sees, including for adapter and plugin tools.
    return codeCallAppIdOf(this.scope, tool);
  }

  /**
   * Searches for tools matching the query
   * Implements the ToolSearch interface
   */
  async search(query: string, options: SymbolToolSearchOptions = {}): Promise<SymbolToolSearchResult[]> {
    // Ensure we're subscribed to tool changes before searching
    await this.ensureSubscribed();
    await this.indexing;

    const { topK = this.config.defaultTopK, appIds, excludeToolNames = [], surface } = options;
    const minScore = this.config.defaultSimilarityThreshold;

    // Build filter function
    const filter = (metadata: ToolMetadata): boolean => {
      // Exclude tools
      if (excludeToolNames.includes(metadata.toolName)) {
        return false;
      }

      // Leave out tools the caller's surface isn't offered (`availableWhen.surface`)
      if (!isOfferedToCaller(metadata.toolInstance.metadata.availableWhen, surface)) {
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
   * Gets the total number of indexed tools, or of those a caller on `surface` may reach
   */
  getTotalCount(surface?: string): number {
    if (surface !== undefined) {
      return this.getAllToolNames().filter((toolName) => this.hasTool(toolName, surface)).length;
    }
    if (this.vectorDB instanceof VectoriaDB) {
      return this.vectorDB.size();
    } else {
      return this.vectorDB.getDocumentCount();
    }
  }

  /**
   * Checks if a tool exists in the index, for a caller on `surface` when given
   */
  hasTool(toolName: string, surface?: string): boolean {
    const indexed =
      this.vectorDB instanceof VectoriaDB ? this.vectorDB.has(toolName) : this.vectorDB.hasDocument(toolName);
    return indexed && isOfferedToCaller(this.availabilityByTool.get(toolName), surface);
  }

  /**
   * Clears the entire index
   */
  clear(): void {
    this.vectorDB.clear();
    this.availabilityByTool = new Map();
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
