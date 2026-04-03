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
  | 'config'
  | 'testing'
  | 'guides'
  | 'production'
  | 'extensibility'
  | 'observability';

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
  /** Target-specific storage defaults (e.g., { node: 'redis-docker', vercel: 'vercel-kv' }) */
  storageDefault?: Record<string, string>;
  /** Tags for secondary filtering and search */
  tags: string[];
  /** Bundle membership for scaffold presets */
  bundle?: SkillBundle[];
  /** Install configuration for future distribution (optional — not yet used by CLI) */
  install?: SkillInstallConfig;
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
  'config',
  'testing',
  'guides',
  'production',
  'extensibility',
  'observability',
];

/** Valid bundles for manifest validation */
export const VALID_BUNDLES: readonly SkillBundle[] = ['recommended', 'minimal', 'full'];
