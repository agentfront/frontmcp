import 'reflect-metadata';
import { extendedSkillMetadata, FrontMcpSkillTokens } from '../tokens';
import { SkillMetadata, skillMetadataSchema } from '../metadata';
import { SkillKind, SkillValueRecord } from '../records';

/**
 * Class decorator that marks a class as a Skill and provides metadata.
 *
 * Skills are knowledge/workflow packages that teach AI how to perform
 * multi-step tasks using tools. Unlike tools, skills don't execute
 * directly - they provide instructions and context for LLMs.
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
 * @example Skill with file-based instructions
 * ```typescript
 * @Skill({
 *   name: 'deploy-app',
 *   description: 'Deploy application to production',
 *   instructions: { file: './skills/deploy.md' },
 *   tools: ['docker_build', 'k8s_apply'],
 *   tags: ['devops', 'deployment'],
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
  };
}

/**
 * Function helper that creates an inline skill record.
 *
 * Use this when you want to define a skill without creating a class.
 * The skill is registered as a value record with a unique symbol token.
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

  return {
    kind: SkillKind.VALUE,
    provide: skillToken,
    // Cast to SkillMetadata - Zod's output type has internal type markers that don't match exactly
    metadata: parsedMetadata as SkillMetadata,
  };
}

// Export with aliases
export { FrontMcpSkill, FrontMcpSkill as Skill, frontMcpSkill, frontMcpSkill as skill };

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
