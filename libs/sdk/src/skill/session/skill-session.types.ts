// file: libs/sdk/src/skill/session/skill-session.types.ts

/**
 * Policy mode for skill tool authorization.
 * Determines how the system handles tool calls not in the skill's allowlist.
 */
export type SkillPolicyMode =
  | 'strict' // Block unapproved tools completely
  | 'approval' // Ask human approval for unapproved tools (via elicitation)
  | 'permissive'; // Allow with warning (logging only)

/**
 * Information about a single active skill.
 */
export interface ActiveSkillInfo {
  /**
   * Skill identifier.
   */
  id: string;

  /**
   * Human-readable skill name.
   */
  name: string;

  /**
   * Tools allowed by this skill.
   */
  allowedTools: Set<string>;

  /**
   * Tools required by this skill.
   */
  requiredTools: Set<string>;

  /**
   * When this skill was activated.
   */
  activatedAt: number;
}

/**
 * State of an active skill session.
 * Tracks which skills are active and what tools they allow.
 * Multiple skills can be active simultaneously, expanding the allowed toolset.
 */
export interface SkillSessionState {
  /**
   * Unique session identifier (from MCP session).
   */
  sessionId: string;

  /**
   * ID of the most recently activated skill, or null if no skill is active.
   * When multiple skills are active, this is the most recent one.
   */
  activeSkillId: string | null;

  /**
   * Name of the most recently activated skill, or null if no skill is active.
   * When multiple skills are active, this is the most recent one.
   */
  activeSkillName: string | null;

  /**
   * Map of active skills by ID.
   * Multiple skills can be active at once, expanding the allowed toolset.
   */
  activeSkills: Map<string, ActiveSkillInfo>;

  /**
   * Set of tool names allowed by all active skills (union).
   * When skills are loaded, this is the combined allowlist from all active skills.
   */
  allowedTools: Set<string>;

  /**
   * Set of tool names that are required by any active skill.
   * Missing required tools may cause skill execution to fail.
   */
  requiredTools: Set<string>;

  /**
   * Policy mode for this session.
   * Determines how unapproved tool calls are handled.
   */
  policyMode: SkillPolicyMode;

  /**
   * Timestamp when the skill was activated.
   */
  startedAt: number;

  /**
   * Tools that have been dynamically approved during this session.
   * Used when policyMode is 'approval' and user approves additional tools.
   */
  approvedTools: Set<string>;

  /**
   * Tools that have been explicitly denied during this session.
   */
  deniedTools: Set<string>;

  /**
   * Count of tool calls made during this skill session.
   */
  toolCallCount: number;

  /**
   * Optional metadata for tracking/analytics.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Options for configuring skill session behavior.
 */
export interface SkillSessionOptions {
  /**
   * Default policy mode for new skill sessions.
   * @default 'permissive'
   */
  defaultPolicyMode?: SkillPolicyMode;

  /**
   * Whether skills must be explicitly activated via loadSkill.
   * If false, tool calls without an active skill are always allowed.
   * @default false
   */
  requireExplicitActivation?: boolean;

  /**
   * Whether to track tool usage statistics.
   * @default true
   */
  trackToolUsage?: boolean;

  /**
   * Maximum number of tool calls allowed per skill session.
   * Set to 0 for unlimited.
   * @default 0
   */
  maxToolCallsPerSession?: number;

  /**
   * Maximum duration in milliseconds for a skill session.
   * Session is automatically deactivated after this time.
   * Set to 0 for unlimited.
   * @default 0
   */
  maxSessionDuration?: number;
}

/**
 * Result of activating a skill session.
 */
export interface SkillActivationResult {
  /**
   * The created session state.
   */
  session: SkillSessionState;

  /**
   * Tools from the skill that are available in the current scope.
   */
  availableTools: string[];

  /**
   * Tools from the skill that are missing from the current scope.
   */
  missingTools: string[];

  /**
   * Whether all required tools are available.
   */
  isComplete: boolean;

  /**
   * Warning message if some tools are missing.
   */
  warning?: string;
}

/**
 * Result of checking tool authorization.
 */
export interface ToolAuthorizationResult {
  /**
   * Whether the tool call is allowed.
   */
  allowed: boolean;

  /**
   * Reason for the authorization decision.
   */
  reason:
    | 'skill_allowlist' // Tool is in skill's allowlist
    | 'dynamically_approved' // Tool was approved during session
    | 'no_active_skill' // No skill is active, default allow
    | 'not_in_allowlist' // Tool not in skill's allowlist
    | 'denied' // Tool was explicitly denied
    | 'rate_limited'; // Too many tool calls

  /**
   * Whether human approval should be requested.
   * Only true when policyMode is 'approval' and tool not in allowlist.
   */
  requiresApproval?: boolean;

  /**
   * ID of the primary/most recent active skill, if any.
   * When multiple skills are active, this is the most recently activated one.
   */
  skillId?: string;

  /**
   * Human-readable name of the primary/most recent active skill, if any.
   * When multiple skills are active, this is the most recently activated one.
   */
  skillName?: string;

  /**
   * IDs of all active skills in the session.
   * When multiple skills are loaded, this contains all of them.
   */
  activeSkillIds?: string[];

  /**
   * Names of all active skills in the session.
   * When multiple skills are loaded, this contains all of them.
   */
  activeSkillNames?: string[];

  /**
   * Name of the tool being checked.
   */
  toolName: string;

  /**
   * Additional context for the authorization decision.
   */
  context?: Record<string, unknown>;
}

/**
 * Event emitted when a skill session changes.
 */
export interface SkillSessionEvent {
  /**
   * Type of session event.
   */
  type: 'activated' | 'deactivated' | 'tool_approved' | 'tool_denied' | 'tool_called';

  /**
   * Session ID.
   */
  sessionId: string;

  /**
   * Skill ID, if applicable.
   */
  skillId?: string;

  /**
   * Tool name, if applicable.
   */
  toolName?: string;

  /**
   * Timestamp of the event.
   */
  timestamp: number;

  /**
   * Additional event data.
   */
  data?: Record<string, unknown>;
}

/**
 * Security policy for a specific skill.
 * Can be defined in skill metadata to override session defaults.
 */
export interface SkillSecurityPolicy {
  /**
   * Policy mode for this skill.
   * Overrides session default.
   */
  policyMode?: SkillPolicyMode;

  /**
   * If true, only explicitly listed tools are allowed.
   * No dynamic approval possible.
   * @default false
   */
  strictAllowlist?: boolean;

  /**
   * Whether tools can be dynamically approved at runtime.
   * @default true
   */
  allowDynamicApproval?: boolean;

  /**
   * Audit level for this skill.
   * @default 'basic'
   */
  auditLevel?: 'none' | 'basic' | 'verbose';

  /**
   * Maximum tool calls for this skill.
   * Overrides session default.
   */
  maxToolCalls?: number;

  /**
   * Maximum session duration for this skill in milliseconds.
   * Overrides session default.
   */
  maxDuration?: number;
}

/**
 * Serialized version of ActiveSkillInfo for storage.
 */
export interface SerializedActiveSkillInfo {
  id: string;
  name: string;
  allowedTools: string[];
  requiredTools: string[];
  activatedAt: number;
}

/**
 * Serializable version of SkillSessionState for storage.
 */
export interface SerializedSkillSessionState {
  sessionId: string;
  activeSkillId: string | null;
  activeSkillName: string | null;
  activeSkills: SerializedActiveSkillInfo[];
  allowedTools: string[];
  requiredTools: string[];
  policyMode: SkillPolicyMode;
  startedAt: number;
  approvedTools: string[];
  deniedTools: string[];
  toolCallCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Convert SkillSessionState to serializable format.
 */
export function serializeSessionState(state: SkillSessionState): SerializedSkillSessionState {
  const activeSkills: SerializedActiveSkillInfo[] = [];
  for (const [, skill] of state.activeSkills) {
    activeSkills.push({
      id: skill.id,
      name: skill.name,
      allowedTools: Array.from(skill.allowedTools),
      requiredTools: Array.from(skill.requiredTools),
      activatedAt: skill.activatedAt,
    });
  }

  return {
    sessionId: state.sessionId,
    activeSkillId: state.activeSkillId,
    activeSkillName: state.activeSkillName,
    activeSkills,
    allowedTools: Array.from(state.allowedTools),
    requiredTools: Array.from(state.requiredTools),
    policyMode: state.policyMode,
    startedAt: state.startedAt,
    approvedTools: Array.from(state.approvedTools),
    deniedTools: Array.from(state.deniedTools),
    toolCallCount: state.toolCallCount,
    metadata: state.metadata,
  };
}

/**
 * Convert serialized format back to SkillSessionState.
 */
export function deserializeSessionState(data: SerializedSkillSessionState): SkillSessionState {
  const activeSkills = new Map<string, ActiveSkillInfo>();
  for (const skill of data.activeSkills || []) {
    activeSkills.set(skill.id, {
      id: skill.id,
      name: skill.name,
      allowedTools: new Set(skill.allowedTools),
      requiredTools: new Set(skill.requiredTools),
      activatedAt: skill.activatedAt,
    });
  }

  return {
    sessionId: data.sessionId,
    activeSkillId: data.activeSkillId,
    activeSkillName: data.activeSkillName,
    activeSkills,
    allowedTools: new Set(data.allowedTools),
    requiredTools: new Set(data.requiredTools),
    policyMode: data.policyMode,
    startedAt: data.startedAt,
    approvedTools: new Set(data.approvedTools),
    deniedTools: new Set(data.deniedTools),
    toolCallCount: data.toolCallCount,
    metadata: data.metadata,
  };
}

/**
 * Create a new empty skill session state.
 */
export function createEmptySessionState(sessionId: string, options?: SkillSessionOptions): SkillSessionState {
  return {
    sessionId,
    activeSkillId: null,
    activeSkillName: null,
    activeSkills: new Map(),
    allowedTools: new Set(),
    requiredTools: new Set(),
    policyMode: options?.defaultPolicyMode ?? 'permissive',
    startedAt: 0,
    approvedTools: new Set(),
    deniedTools: new Set(),
    toolCallCount: 0,
  };
}
