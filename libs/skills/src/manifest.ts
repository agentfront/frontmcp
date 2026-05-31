/**
 * Skills catalog manifest types.
 *
 * Defines the contract between the catalog, scaffold tooling, and future installer.
 *
 * @module skills/manifest
 */

/**
 * Supported deployment targets for skill filtering.
 */
export type SkillTarget = 'node' | 'vercel' | 'lambda' | 'cloudflare' | 'all';

/**
 * Skill categories for organizing the catalog.
 */
export type SkillCategory =
  | 'setup'
  | 'deployment'
  | 'development'
  | 'development/create'
  | 'config'
  | 'testing'
  | 'guides'
  | 'production'
  | 'extensibility'
  | 'observability';

/**
 * Catalog layouts the validator understands.
 *
 * - `router` (default): the legacy shape used by skills like `frontmcp-development`
 *   — a Scenario Routing Table SKILL.md plus `references/<topic>.md` files with
 *   examples grouped in `examples/<topic>/<example>.md` subdirectories.
 *
 * - `component`: the new per-thing layout used by skills like `create-tool`
 *   — flat `examples/<example>.md` (no per-reference grouping), an optional
 *   `rules/` directory with short DO/DON'T files, and rich SKILL.md frontmatter
 *   designed for Claude Code's auto-trigger heuristics (explicit `triggers:`,
 *   `paths:` globs, `when_to_use`).
 */
export type SkillLayout = 'router' | 'component';

/**
 * Bundle membership for curated scaffold presets.
 */
export type SkillBundle = 'recommended' | 'minimal' | 'full';

/**
 * Install destination types for future provider wiring.
 */
export type SkillDestination = 'project-local' | '.claude/skills' | 'codex' | 'gemini';

/**
 * Merge strategy when installing a skill that already exists at the destination.
 */
export type SkillMergeStrategy = 'overwrite' | 'skip-existing';

/**
 * Install configuration for a catalog skill.
 */
export interface SkillInstallConfig {
  /** Where this skill can be installed */
  destinations: SkillDestination[];
  /** How to handle existing skills at the destination */
  mergeStrategy: SkillMergeStrategy;
  /** Other skills this depends on (by name) */
  dependencies?: string[];
}

/**
 * Complexity level for a reference example.
 */
export type SkillExampleLevel = 'basic' | 'intermediate' | 'advanced';

/**
 * Metadata for a single example file within a reference's examples/ directory.
 */
export interface SkillReferenceExampleEntry {
  /** Example name — matches filename without extension */
  name: string;
  /** Short description of what the example demonstrates */
  description: string;
  /** Complexity level */
  level: SkillExampleLevel;
  /** Searchable tags for the example */
  tags: string[];
  /** Concrete APIs or patterns the example demonstrates */
  features: string[];
}

/**
 * Metadata for a single reference file within a skill's references/ directory.
 * Extracted from YAML frontmatter or inferred from the markdown heading.
 */
export interface SkillReferenceEntry {
  /** Reference name — matches filename without extension */
  name: string;
  /** Short description from frontmatter or first paragraph */
  description: string;
  /** Example files for this reference, located in examples/<reference-name>/ */
  examples?: SkillReferenceExampleEntry[];
}

/**
 * Top-level example entry used by `layout: 'component'` skills, where
 * examples live flat under `examples/<example>.md` (not grouped under a
 * parent reference). Shape mirrors {@link SkillReferenceExampleEntry} so
 * downstream consumers can use a uniform metadata type.
 */
export interface SkillComponentExampleEntry {
  /** Example name — matches filename without extension */
  name: string;
  /** Short description of what the example demonstrates */
  description: string;
  /** Complexity level */
  level: SkillExampleLevel;
  /** Searchable tags for the example */
  tags: string[];
  /** Concrete APIs or patterns the example demonstrates */
  features: string[];
}

/**
 * Top-level rule entry used by `layout: 'component'` skills. Rules are short
 * DO / DON'T constraint files under `rules/<rule>.md`. The body explains the
 * rule, gives good / bad examples, and (where possible) ends with a grep-based
 * verification snippet.
 */
export interface SkillComponentRuleEntry {
  /** Rule name — matches filename without extension */
  name: string;
  /** One-sentence statement of the rule */
  constraint: string;
  /** Enforcement strength — `required` for must-follow, `recommended` for nudges */
  severity?: 'required' | 'recommended';
}

/**
 * A single entry in the skills catalog manifest.
 *
 * This is the core contract connecting SKILL.md files to scaffolding,
 * future installation, and provider-specific destinations.
 */
export interface SkillCatalogEntry {
  /** Unique skill name — matches SKILL.md frontmatter `name` */
  name: string;
  /** Skill category for organization */
  category: SkillCategory;
  /** Short description */
  description: string;
  /** Path to the skill directory, relative to catalog/ */
  path: string;
  /** Deployment targets this skill applies to */
  targets: SkillTarget[];
  /** Whether the skill has scripts/, references/, or assets/ directories */
  hasResources: boolean;
  /** Resolved reference metadata from references/ directory */
  references?: SkillReferenceEntry[];
  /**
   * Catalog layout — see {@link SkillLayout}. Defaults to `'router'` when
   * absent for backward compatibility with the legacy frontmcp-* router
   * skills.
   */
  layout?: SkillLayout;
  /**
   * Top-level example entries — only populated when `layout === 'component'`.
   * Router-layout skills group examples under `references[].examples`
   * instead.
   */
  examples?: SkillComponentExampleEntry[];
  /**
   * Top-level rule entries — only populated when `layout === 'component'`.
   * Each rule corresponds to a file in `rules/<name>.md`.
   */
  rules?: SkillComponentRuleEntry[];
  /**
   * Priority hint surfaced to Claude Code's auto-discovery. Higher number =
   * earlier in the ranking. Mirrors `metadata.priority` in SKILL.md
   * frontmatter.
   */
  priority?: number;
  /** Target-specific storage defaults (e.g., { node: 'redis-docker', vercel: 'vercel-kv' }) */
  storageDefault?: Record<string, string>;
  /** Tags for secondary filtering and search */
  tags: string[];
  /** Bundle membership for scaffold presets */
  bundle?: SkillBundle[];
  /** Install configuration for future distribution (optional — not yet used by CLI) */
  install?: SkillInstallConfig;
  /**
   * Optional skill quality rating (0..5, one decimal). Surfaced via the
   * Skills HTTP API for consumers that want to filter by `min-rating` or
   * sort by quality. Mirrors `SkillMetadata.rating` introduced in v1.2.0.
   */
  rating?: number;
  /**
   * Other catalog skills this skill depends on (by `name`). Used by the
   * dependency resolver introduced in v1.2.0 to register dependencies first
   * during scaffold/install. Aligns with the agentskills Skill Package
   * Manifest proposal `requires` field.
   */
  requires?: string[];
}

/**
 * The skills catalog manifest — single source of truth for scaffold and install tooling.
 */
export interface SkillManifest {
  /** Manifest schema version */
  version: 1;
  /** All catalog skills */
  skills: SkillCatalogEntry[];
}

/** Valid example levels for manifest validation */
export const VALID_EXAMPLE_LEVELS: readonly SkillExampleLevel[] = ['basic', 'intermediate', 'advanced'];

/** Valid deployment targets for manifest validation */
export const VALID_TARGETS: readonly SkillTarget[] = ['node', 'vercel', 'lambda', 'cloudflare', 'all'];

/** Valid categories for manifest validation */
export const VALID_CATEGORIES: readonly SkillCategory[] = [
  'setup',
  'deployment',
  'development',
  'development/create',
  'config',
  'testing',
  'guides',
  'production',
  'extensibility',
  'observability',
];

/** Valid layouts for manifest validation */
export const VALID_LAYOUTS: readonly SkillLayout[] = ['router', 'component'];

/** Valid bundles for manifest validation */
export const VALID_BUNDLES: readonly SkillBundle[] = ['recommended', 'minimal', 'full'];
