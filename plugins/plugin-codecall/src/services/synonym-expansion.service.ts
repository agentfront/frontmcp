// file: libs/plugins/src/codecall/services/synonym-expansion.service.ts

/**
 * Universal Synonym groups for MCP Tool searching.
 *
 * DESIGN PRINCIPLE:
 * These groups bridge the gap between "User Intent" (Natural Language)
 * and "System Function" (API/Tool Names).
 *
 * STRUCTURE:
 * 1. Core Data Operations (CRUD+)
 * 2. State & Lifecycle
 * 3. Transfer & IO
 * 4. DevOps & Technical
 * 5. Commerce & Business Logic
 * 6. Communication & Social
 * 7. Universal Entities (Nouns)
 */
const DEFAULT_SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  // ===========================================================================
  // 1. CORE DATA OPERATIONS (CRUD+)
  // ===========================================================================

  // Creation / Instantiation
  [
    'create',
    'add',
    'new',
    'insert',
    'make',
    'append',
    'register',
    'generate',
    'produce',
    'build',
    'construct',
    'provision',
    'instantiate',
    'define',
    'compose',
    'draft',
  ],

  // Destructive Removal
  [
    'delete',
    'remove',
    'destroy',
    'drop',
    'erase',
    'clear',
    'purge',
    'discard',
    'eliminate',
    'nuke',
    'unbind',
    'unregister',
  ],

  // Retrieval / Access
  ['get', 'fetch', 'retrieve', 'read', 'obtain', 'load', 'pull', 'access', 'grab', 'snag', 'receive'],

  // Modification
  [
    'update',
    'edit',
    'modify',
    'change',
    'patch',
    'alter',
    'revise',
    'refresh',
    'correct',
    'amend',
    'adjust',
    'tweak',
    'rectify',
    'refine',
  ],

  // Viewing / Listing
  [
    'list',
    'show',
    'display',
    'enumerate',
    'browse',
    'view',
    'peek',
    'index',
    'catalog',
    'survey',
    'inspect',
    'ls',
    'dir',
  ],

  // Searching / Discovery
  [
    'find',
    'search',
    'lookup',
    'query',
    'locate',
    'filter',
    'scan',
    'explore',
    'investigate',
    'detect',
    'scout',
    'seek',
  ],

  // Soft Delete / Archival
  ['archive', 'shelve', 'retire', 'hide', 'suppress', 'mute'],
  ['unarchive', 'restore', 'recover', 'undelete', 'unhide'],

  // ===========================================================================
  // 2. STATE & LIFECYCLE
  // ===========================================================================

  // Activation
  [
    'enable',
    'activate',
    'start',
    'turn on',
    'switch on',
    'boot',
    'init',
    'initialize',
    'setup',
    'spin up',
    'resume',
    'unpause',
  ],

  // Deactivation
  [
    'disable',
    'deactivate',
    'stop',
    'turn off',
    'switch off',
    'shutdown',
    'halt',
    'kill',
    'terminate',
    'suspend',
    'pause',
    'cease',
  ],

  // Execution
  ['run', 'execute', 'invoke', 'trigger', 'launch', 'call', 'perform', 'operate', 'handle', 'process', 'fire'],

  // Reset cycles
  ['restart', 'reboot', 'reset', 'reload', 'bounce', 'recycle', 'refresh'],

  // Validation & Check
  ['validate', 'verify', 'check', 'confirm', 'assert', 'test', 'audit', 'assess', 'healthcheck', 'ping'],

  // Analysis & Math
  [
    'analyze',
    'interpret',
    'diagnose',
    'evaluate',
    'review',
    'summarize',
    'count',
    'calculate',
    'compute',
    'measure',
    'aggregate',
    'summarise',
  ],

  // ===========================================================================
  // 3. TRANSFER, IO & MANIPULATION
  // ===========================================================================

  // Duplication
  ['copy', 'duplicate', 'clone', 'replicate', 'mirror', 'fork', 'repro'],

  // Movement
  ['move', 'transfer', 'migrate', 'relocate', 'rename', 'shift', 'mv', 'slide'],

  // Persistence
  ['save', 'store', 'write', 'persist', 'commit', 'stash', 'record', 'log'],

  // Synchronization
  ['sync', 'synchronize', 'resync', 'reconcile', 'align', 'pair'],

  // Import/Export
  ['import', 'ingest', 'upload', 'push', 'feed'],
  ['export', 'download', 'dump', 'backup', 'extract'],

  // Connection
  ['connect', 'link', 'bind', 'attach', 'join', 'bridge', 'associate', 'mount', 'map'],
  ['disconnect', 'unlink', 'unbind', 'detach', 'leave', 'dissociate', 'unmount', 'unmap'],

  // ===========================================================================
  // 4. DEVOPS, SECURITY & TECHNICAL
  // ===========================================================================

  // Auth
  ['login', 'log in', 'sign in', 'authenticate', 'auth'],
  ['logout', 'log out', 'sign out', 'disconnect'],

  // Permissions
  ['approve', 'authorize', 'grant', 'permit', 'allow', 'sanction', 'whitelist'],
  ['deny', 'reject', 'revoke', 'forbid', 'block', 'ban', 'blacklist'],

  // Encryption
  ['encrypt', 'secure', 'lock', 'seal', 'protect', 'scramble', 'hash'],
  ['decrypt', 'unlock', 'unseal', 'reveal', 'decode'],

  // Deployment
  ['deploy', 'release', 'ship', 'publish', 'roll out', 'promote', 'distribute', 'install'],

  // Development
  ['debug', 'troubleshoot', 'fix', 'repair', 'resolve', 'trace'],
  ['compile', 'transpile', 'build', 'assemble', 'package', 'bundle', 'minify'],

  // ===========================================================================
  // 5. COMMERCE & BUSINESS LOGIC
  // ===========================================================================

  // Financial Transactions
  ['buy', 'purchase', 'order', 'pay', 'checkout', 'spend'],
  ['sell', 'refund', 'reimburse', 'charge', 'invoice', 'bill'],
  ['subscribe', 'upgrade', 'upsell'],
  ['unsubscribe', 'cancel', 'downgrade'],

  // Scheduling
  ['schedule', 'book', 'appoint', 'reserve', 'plan', 'calendar'],
  ['reschedule', 'postpone', 'delay', 'defer'],

  // ===========================================================================
  // 6. COMMUNICATION & SOCIAL
  // ===========================================================================

  // Outbound
  [
    'send',
    'dispatch',
    'deliver',
    'transmit',
    'post',
    'broadcast',
    'notify',
    'alert',
    'email',
    'text',
    'message',
    'chat',
  ],

  // Social Interactions
  ['reply', 'respond', 'answer', 'retort'],
  ['share', 'forward', 'retweet', 'repost'],
  ['like', 'favorite', 'star', 'upvote', 'heart'],
  ['dislike', 'downvote'],
  ['follow', 'watch', 'track'],
  ['unfollow', 'ignore', 'mute'],

  // ===========================================================================
  // 7. COMMON ENTITIES (NOUNS)
  // ===========================================================================

  // Users & Roles
  [
    'user',
    'account',
    'member',
    'profile',
    'identity',
    'customer',
    'principal',
    'admin',
    'operator',
    'client',
    'employee',
    'staff',
  ],
  ['role', 'group', 'team', 'squad', 'unit', 'department'],

  // Data Artifacts
  ['file', 'document', 'attachment', 'blob', 'asset', 'object', 'resource', 'content', 'media'],
  ['image', 'picture', 'photo', 'screenshot'],
  ['video', 'clip', 'recording', 'footage'],

  // System Artifacts
  ['message', 'notification', 'alert', 'event', 'signal', 'webhook', 'ping'],
  ['log', 'trace', 'metric', 'telemetry', 'audit trail', 'history'],
  ['settings', 'config', 'configuration', 'preferences', 'options', 'params', 'env', 'environment', 'variables'],
  ['permission', 'privilege', 'access right', 'policy', 'rule', 'scope'],

  // Business Artifacts
  ['organization', 'company', 'tenant', 'workspace', 'org', 'project', 'repo', 'repository'],
  ['product', 'item', 'sku', 'inventory', 'stock'],
  ['task', 'ticket', 'issue', 'bug', 'story', 'epic', 'todo', 'job', 'workitem'],

  // Identification
  ['id', 'identifier', 'key', 'uuid', 'guid', 'token', 'hash', 'fingerprint'],
];

/**
 * Configuration for the SynonymExpansionService
 */
export interface SynonymExpansionConfig {
  /**
   * Additional synonym groups to include beyond defaults.
   * Each group is an array of related terms.
   */
  additionalSynonyms?: ReadonlyArray<ReadonlyArray<string>>;

  /**
   * If true, completely replace default synonyms with additionalSynonyms.
   * @default false
   */
  replaceDefaults?: boolean;

  /**
   * Maximum number of expanded terms per input term.
   * Prevents query explosion.
   * @default 5
   */
  maxExpansionsPerTerm?: number;
}

/**
 * Lightweight synonym expansion service for improving TF-IDF search relevance.
 * Zero dependencies, synchronous, and easily extensible.
 *
 * This service provides query-time synonym expansion to help TF-IDF-based
 * search understand that semantically similar terms (like "add" and "create")
 * should match the same tools.
 */
export class SynonymExpansionService {
  private synonymMap: Map<string, Set<string>>;
  private maxExpansions: number;

  constructor(config: SynonymExpansionConfig = {}) {
    this.maxExpansions = config.maxExpansionsPerTerm ?? 5;

    // Build synonym map from groups
    const groups = config.replaceDefaults
      ? config.additionalSynonyms || []
      : [...DEFAULT_SYNONYM_GROUPS, ...(config.additionalSynonyms || [])];

    this.synonymMap = this.buildSynonymMap(groups);
  }

  /**
   * Build a bidirectional synonym map from groups.
   * Each term maps to all other terms in its group(s).
   */
  private buildSynonymMap(groups: ReadonlyArray<ReadonlyArray<string>>): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();

    for (const group of groups) {
      const normalizedGroup = group.map((term) => term.toLowerCase());

      for (const term of normalizedGroup) {
        if (!map.has(term)) {
          map.set(term, new Set());
        }
        const synonyms = map.get(term)!;

        // Add all other terms in the group as synonyms
        for (const synonym of normalizedGroup) {
          if (synonym !== term) {
            synonyms.add(synonym);
          }
        }
      }
    }

    return map;
  }

  /**
   * Get synonyms for a single term.
   * Returns empty array if no synonyms found.
   *
   * @example
   * getSynonyms('add') // ['create', 'new', 'insert', 'make']
   */
  getSynonyms(term: string): string[] {
    const normalized = term.toLowerCase();
    const synonyms = this.synonymMap.get(normalized);

    if (!synonyms) {
      return [];
    }

    // Return limited synonyms to prevent query explosion
    return Array.from(synonyms).slice(0, this.maxExpansions);
  }

  /**
   * Expand a query string by adding synonyms for each term.
   * Returns the expanded query string with original terms and their synonyms.
   *
   * @example
   * expandQuery('add user') // 'add create new insert make user account member profile'
   */
  expandQuery(query: string): string {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1);

    const expandedTerms: string[] = [];

    for (const term of terms) {
      // Always include the original term first
      expandedTerms.push(term);

      // Add synonyms
      const synonyms = this.getSynonyms(term);
      expandedTerms.push(...synonyms);
    }

    return expandedTerms.join(' ');
  }

  /**
   * Check if synonym expansion is available for any term in the query.
   */
  hasExpansions(query: string): boolean {
    const terms = query.toLowerCase().split(/\s+/);
    return terms.some((term) => this.synonymMap.has(term));
  }

  /**
   * Get statistics about the synonym dictionary.
   */
  getStats(): { termCount: number; avgSynonymsPerTerm: number } {
    const termCount = this.synonymMap.size;
    let totalSynonyms = 0;

    for (const synonyms of this.synonymMap.values()) {
      totalSynonyms += synonyms.size;
    }

    return {
      termCount,
      avgSynonymsPerTerm: termCount > 0 ? totalSynonyms / termCount : 0,
    };
  }
}
