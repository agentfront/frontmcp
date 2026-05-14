import 'reflect-metadata';

import { dirname } from '@frontmcp/utils';

import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import { skillMetadataSchema, type EsmOptions, type RemoteOptions, type SkillMetadata } from '../metadata';
import { SkillKind, type SkillValueRecord } from '../records';
// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: Skill.esm() and Skill.remote()
// ═══════════════════════════════════════════════════════════════════

import { type SkillEsmTargetRecord, type SkillRemoteRecord } from '../records/skill.record';
import { extendedSkillMetadata, FrontMcpSkillTokens, skillCallerDir } from '../tokens';
import { validateRemoteUrl } from '../utils/validate-remote-url';

/**
 * Class decorator that marks a class as a Skill and provides metadata.
 *
 * Skills are knowledge/workflow packages that teach AI how to perform
 * multi-step tasks using tools. Unlike tools, skills don't execute
 * directly - they provide instructions and context for LLMs.
 *
 * Aligned with the Anthropic Agent Skills specification:
 * - `name`: kebab-case, max 64 chars, no consecutive hyphens
 * - `description`: max 1024 chars, no XML/HTML tags
 * - Supports `license`, `compatibility`, `specMetadata`, `allowedTools`, `resources`
 *
 * ## File path resolution
 *
 * When `instructions: { file: './…' }`, `resources.references: './…'`, or
 * `resources.examples: './…'` are relative, they are resolved relative to
 * the directory of the source file that declared the `@Skill` class —
 * **not** the process `cwd`. The directory is captured at decoration time
 * by walking the call stack. This matches the behaviour of the inline
 * `skill()` helper, and works under both CJS and ESM. If the caller
 * cannot be determined (e.g. an exotic loader strips stack frames), the
 * framework falls back to the build-time `_skills/manifest.json` for
 * bundled CLIs and otherwise to the legacy `cwd`-relative behaviour.
 *
 * @param providedMetadata - Skill metadata including name, description, and instructions
 * @returns Class decorator
 *
 * @example Basic skill
 * ```typescript
 * @Skill({
 *   name: 'review-pr',
 *   description: 'Review a GitHub pull request',
 *   instructions: 'Step 1: Fetch PR details...',
 *   tools: ['github_get_pr', 'github_add_comment'],
 * })
 * class ReviewPRSkill extends SkillContext {
 *   async loadInstructions() { return this.metadata.instructions as string; }
 *   async build() { ... }
 * }
 * ```
 *
 * @example Skill with Agent Skills spec fields
 * ```typescript
 * @Skill({
 *   name: 'deploy-app',
 *   description: 'Deploy application to production',
 *   instructions: { file: './skills/deploy.md' },
 *   tools: ['docker_build', 'k8s_apply'],
 *   tags: ['devops', 'deployment'],
 *   license: 'MIT',
 *   compatibility: 'Requires Docker 24+ and kubectl',
 *   allowedTools: 'Read Edit Bash(docker build)',
 * })
 * class DeploySkill extends SkillContext { ... }
 * ```
 *
 * @example Skill with URL-based instructions
 * ```typescript
 * @Skill({
 *   name: 'security-audit',
 *   description: 'Perform security audit on codebase',
 *   instructions: { url: 'https://example.com/skills/security-audit.md' },
 *   tools: ['code_search', 'file_read'],
 * })
 * class SecurityAuditSkill extends SkillContext { ... }
 * ```
 */
function FrontMcpSkill(providedMetadata: SkillMetadata): ClassDecorator {
  // Capture the caller directory at decorator-evaluation time (i.e. when the
  // user's source file is being loaded), before returning the inner function.
  // This is the moment the user's file is on the stack; deferring until the
  // class body executes would still work but is less robust under bundling.
  const callerDir = resolveCallerDir();

  return (target: object) => {
    const metadata = skillMetadataSchema.parse(providedMetadata);
    Reflect.defineMetadata(FrontMcpSkillTokens.type, true, target);

    const extended: Record<string, unknown> = {};
    for (const property in metadata) {
      const tokenKey = property as keyof typeof FrontMcpSkillTokens;
      if (FrontMcpSkillTokens[tokenKey]) {
        Reflect.defineMetadata(FrontMcpSkillTokens[tokenKey], metadata[property as keyof SkillMetadata], target);
      } else {
        extended[property] = metadata[property as keyof SkillMetadata];
      }
    }
    Reflect.defineMetadata(extendedSkillMetadata, extended, target);

    if (callerDir) {
      Reflect.defineMetadata(skillCallerDir, callerDir, target);
    }
  };
}

/**
 * Function helper that creates an inline skill record.
 *
 * Use this when you want to define a skill without creating a class.
 * The skill is registered as a value record with a unique symbol token.
 *
 * Name must be kebab-case (max 64 chars, no consecutive hyphens).
 * Description max 1024 chars, no XML/HTML tags.
 *
 * ## File path resolution
 *
 * When `instructions: { file: './…' }`, `resources.references: './…'`, or
 * `resources.examples: './…'` are relative, they are resolved relative to
 * the directory of the source file that called `skill()` — **not** the
 * process `cwd`. The directory is captured at call time by walking the
 * stack. Works under both CJS and ESM.
 *
 * @param providedMetadata - Skill metadata including name, description, and instructions
 * @returns A skill value record that can be passed to app/plugin skills array
 *
 * @example Inline skill
 * ```typescript
 * const reviewPRSkill = skill({
 *   name: 'review-pr',
 *   description: 'Review a GitHub pull request',
 *   instructions: `
 *     ## PR Review Process
 *     1. Fetch the PR details using github_get_pr
 *     2. Review each changed file...
 *   `,
 *   tools: [
 *     { name: 'github_get_pr', purpose: 'Fetch PR details', required: true },
 *     { name: 'github_add_comment', purpose: 'Add review comments' },
 *   ],
 *   tags: ['github', 'code-review'],
 *   license: 'MIT',
 * });
 *
 * @FrontMcp({
 *   name: 'my-app',
 *   skills: [reviewPRSkill],
 * })
 * class MyApp {}
 * ```
 *
 * @example Skill with file-based instructions
 * ```typescript
 * const deploySkill = skill({
 *   name: 'deploy-app',
 *   description: 'Deploy application to production',
 *   instructions: { file: './skills/deploy.md' },
 *   tools: ['docker_build', 'docker_push', 'k8s_apply'],
 * });
 * ```
 */
function frontMcpSkill(providedMetadata: SkillMetadata): SkillValueRecord {
  const parsedMetadata = skillMetadataSchema.parse(providedMetadata);

  // Create a unique symbol for this skill
  const skillToken = Symbol(`skill:${parsedMetadata.name}`);

  // Capture caller directory for resolving relative instruction file paths.
  // Without this, `instructions: { file: './relative.md' }` resolves from cwd instead of the skill file's directory.
  const callerDir = resolveCallerDir();

  return {
    kind: SkillKind.VALUE,
    provide: skillToken,
    // Cast to SkillMetadata - Zod's output type has internal type markers that don't match exactly
    metadata: parsedMetadata as SkillMetadata,
    callerDir,
  };
}

/**
 * Walk the call stack to find the first file outside this module.
 * Returns the directory of that file, or undefined if it cannot be determined.
 *
 * Supports both CJS frames (`at fn (/abs/path/foo.ts:1:1)`) and ESM frames
 * (`at fn (file:///abs/path/foo.ts:1:1)`). For ESM frames, the `file://`
 * scheme is converted via `node:url`'s `fileURLToPath` so the result is a
 * usable filesystem path on both POSIX and Windows.
 */
function resolveCallerDir(): string | undefined {
  return parseCallerDir(new Error().stack);
}

/**
 * Pure helper that parses a V8-format stack string and returns the directory
 * of the first user-code frame. Exported for unit testing only — the
 * production entry point is `resolveCallerDir()`.
 *
 * Filters out:
 *   - Node internals (`node:internal/...`, `node:fs`, etc.)
 *   - `node_modules` packages
 *   - this decorator file itself (basename match — `skill.decorator.ts`/`.js`)
 *
 * @internal
 */
export function parseCallerDir(stack: string | undefined): string | undefined {
  if (!stack) return undefined;

  const lines = stack.split('\n');
  // Start from index 1 (skip the "Error" header line); cap at 30 frames.
  for (let i = 1; i < lines.length && i < 30; i++) {
    const line = lines[i];
    // Match "at func (...:line:col)" and "at ...:line:col"; capture group
    // tolerates `file:///` because it greedily includes the scheme.
    const match = line.match(/\(([^)]+):\d+:\d+\)/) || line.match(/at\s+([^\s]+):\d+:\d+/);
    if (!match) continue;

    let file = match[1];

    // ESM frames surface URLs; convert to a filesystem path before dirname().
    if (file.startsWith('file://')) {
      try {
        // Lazy-require so browser/Edge builds that never import `node:url` stay clean.

        const { fileURLToPath } = require('node:url');
        file = fileURLToPath(file);
      } catch {
        // If node:url is unavailable (browser-ish runtimes), fall back to a
        // best-effort strip. dirname() works on most POSIX cases this way.
        file = file.replace(/^file:\/\//, '');
      }
    }

    // Skip frames that don't represent user code:
    //   - Node internals (`node:internal/...`, `node:fs`, etc.)
    //   - third-party packages (`node_modules`)
    //   - this decorator file itself (match by basename only — `skill.decorator.ts`
    //     or `.js` — so we don't accidentally reject files like `skill.decorator.spec.ts`)
    const basenameMatch = file.match(/[^/\\]+$/);
    const basename = basenameMatch ? basenameMatch[0] : file;
    if (
      file.startsWith('node:') ||
      file.includes('node_modules') ||
      basename === 'skill.decorator.ts' ||
      basename === 'skill.decorator.js'
    ) {
      continue;
    }

    return dirname(file);
  }
  return undefined;
}

function skillEsm(specifier: string, targetName: string, options?: EsmOptions<SkillMetadata>): SkillEsmTargetRecord {
  const parsed = parsePackageSpecifier(specifier);
  return {
    kind: SkillKind.ESM,
    provide: Symbol(`esm-skill:${parsed.fullName}:${targetName}`),
    specifier: parsed,
    targetName,
    options,
    metadata: {
      name: targetName,
      description: `Skill "${targetName}" from ${parsed.fullName}`,
      instructions: options?.metadata?.instructions ?? '',
      ...options?.metadata,
    } as SkillMetadata,
  };
}

function skillRemote(url: string, targetName: string, options?: RemoteOptions<SkillMetadata>): SkillRemoteRecord {
  validateRemoteUrl(url);
  return {
    kind: SkillKind.REMOTE,
    provide: Symbol(`remote-skill:${url}:${targetName}`),
    url,
    targetName,
    transportOptions: options?.transportOptions,
    remoteAuth: options?.remoteAuth,
    metadata: {
      name: targetName,
      description: `Remote skill "${targetName}" from ${url}`,
      instructions: options?.metadata?.instructions ?? '',
      ...options?.metadata,
    } as SkillMetadata,
  };
}

Object.assign(FrontMcpSkill, {
  esm: skillEsm,
  remote: skillRemote,
});

type SkillDecorator = {
  (metadata: SkillMetadata): ClassDecorator;
  esm: typeof skillEsm;
  remote: typeof skillRemote;
};

const Skill = FrontMcpSkill as unknown as SkillDecorator;

// Export with aliases
export { FrontMcpSkill, Skill, frontMcpSkill, frontMcpSkill as skill };

/**
 * Check if a class has the @Skill decorator.
 */
export function isSkillDecorated(target: object): boolean {
  return Reflect.getMetadata(FrontMcpSkillTokens.type, target) === true;
}

/**
 * Get skill metadata from a decorated class.
 */
export function getSkillMetadata(target: object): SkillMetadata | undefined {
  if (!isSkillDecorated(target)) {
    return undefined;
  }

  const metadata: Partial<SkillMetadata> = {};

  // Collect metadata from tokens
  for (const [key, token] of Object.entries(FrontMcpSkillTokens)) {
    if (key === 'type' || key === 'metadata') continue;
    const value = Reflect.getMetadata(token, target);
    if (value !== undefined) {
      (metadata as Record<string, unknown>)[key] = value;
    }
  }

  // Merge extended metadata
  const extended = Reflect.getMetadata(extendedSkillMetadata, target);
  if (extended) {
    Object.assign(metadata, extended);
  }

  return metadata as SkillMetadata;
}
