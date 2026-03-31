// file: libs/sdk/src/skill/tools/read-skill-content.tool.ts

import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { SkillInstance } from '../skill.instance';
import { readFile, pathResolve } from '@frontmcp/utils';
import { parseSkillMdFrontmatter } from '../skill-md-parser';

/**
 * Input schema for readSkillContent tool.
 */
const inputSchema = {
  skillId: z.string().min(1).describe('ID or name of the skill (as returned by searchSkills or loadSkills)'),
  type: z.enum(['reference', 'example']).describe('Type of content to read: reference or example'),
  name: z
    .string()
    .min(1)
    .describe('Name of the reference or example to read (as shown in the routing table from loadSkills)'),
};

/**
 * Output schema for readSkillContent tool.
 */
const outputSchema = {
  skillId: z.string(),
  skillName: z.string(),
  type: z.enum(['reference', 'example']),
  name: z.string(),
  description: z.string(),
  content: z.string().describe('Markdown body with frontmatter stripped'),
  frontmatter: z.record(z.string(), z.unknown()).optional().describe('Parsed YAML frontmatter fields from the file'),
  reference: z.string().optional().describe('Parent reference name (examples only)'),
  level: z.string().optional().describe('Complexity level: basic, intermediate, or advanced (examples only)'),
  available: z
    .array(z.string())
    .optional()
    .describe('Available names for the requested type (included when the requested name is not found)'),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

/**
 * Tool for reading individual reference or example files from a loaded skill.
 *
 * After loading a skill with `loadSkills`, the instructions include a routing table
 * listing available references and examples. Use this tool to read the full content
 * of a specific reference or example file.
 *
 * @example
 * ```typescript
 * // Read a reference
 * const ref = await readSkillContent({
 *   skillId: 'frontmcp-deployment',
 *   type: 'reference',
 *   name: 'deploy-to-vercel',
 * });
 *
 * // Read an example
 * const ex = await readSkillContent({
 *   skillId: 'frontmcp-deployment',
 *   type: 'example',
 *   name: 'vercel-with-kv',
 * });
 * ```
 */
@Tool({
  name: 'readSkillContent',
  description:
    'Read the full content of a specific reference or example from a skill. ' +
    'After loading a skill with loadSkills, the instructions include routing tables ' +
    'listing available references and examples by name. Use this tool to read ' +
    'the complete content of any listed item.\n\n' +
    '**When to use:**\n' +
    '- After loadSkills shows a reference you need to read for detailed guidance\n' +
    '- When you need a worked example for a specific scenario\n' +
    '- When the routing table lists a topic you want to explore further\n\n' +
    '**Example flow:**\n' +
    '1. loadSkills({ skillIds: ["frontmcp-deployment"] }) — see routing table\n' +
    '2. readSkillContent({ skillId: "frontmcp-deployment", type: "reference", name: "deploy-to-vercel" })\n' +
    '3. readSkillContent({ skillId: "frontmcp-deployment", type: "example", name: "vercel-with-kv" })',
  inputSchema,
  outputSchema,
  tags: ['skills', 'references', 'examples', 'content'],
  annotations: {
    title: 'Read Skill Content',
    readOnlyHint: true,
  },
})
export class ReadSkillContentTool extends ToolContext<typeof inputSchema, typeof outputSchema, Input, Output> {
  async execute(input: Input): Promise<Output> {
    const skillRegistry = this.scope.skills;

    if (!skillRegistry) {
      this.fail(new Error('Skills are not available in this scope'));
    }

    // Load skill content (uses cache if already loaded)
    const loadResult = await skillRegistry.loadSkill(input.skillId);
    if (!loadResult) {
      this.fail(new Error(`Skill "${input.skillId}" not found. Use searchSkills to discover available skills.`));
    }

    const { skill } = loadResult;

    // Find the entry to get the SkillInstance for path resolution
    const entry = skillRegistry.findByName(input.skillId);
    if (!entry) {
      this.fail(new Error(`Skill "${input.skillId}" entry not found.`));
    }

    if (input.type === 'reference') {
      return this.readReference(input, skill, entry as SkillInstance);
    }
    return this.readExample(input, skill, entry as SkillInstance);
  }

  private async readReference(
    input: Input,
    skill: { resolvedReferences?: Array<{ name: string; description: string; filename: string }> } & {
      id: string;
      name: string;
    },
    instance: SkillInstance,
  ): Promise<Output> {
    const refs = skill.resolvedReferences ?? [];
    const refEntry = refs.find((r) => r.name === input.name);

    if (!refEntry) {
      const availableNames = refs.map((r) => r.name);
      return {
        skillId: skill.id,
        skillName: skill.name,
        type: 'reference',
        name: input.name,
        description: `Reference "${input.name}" not found.`,
        content:
          availableNames.length > 0
            ? `Reference "${input.name}" not found. Available references: ${availableNames.join(', ')}`
            : `Skill "${skill.name}" has no references.`,
        available: availableNames,
      };
    }

    const content = await this.readFileContent(instance, 'references', refEntry.filename);
    const { frontmatter, body } = parseSkillMdFrontmatter(content);

    return {
      skillId: skill.id,
      skillName: skill.name,
      type: 'reference',
      name: refEntry.name,
      description: refEntry.description,
      content: body,
      frontmatter: flattenFrontmatter(frontmatter),
    };
  }

  private async readExample(
    input: Input,
    skill: {
      resolvedExamples?: Array<{
        name: string;
        description: string;
        reference: string;
        level: string;
        filename: string;
      }>;
    } & {
      id: string;
      name: string;
    },
    instance: SkillInstance,
  ): Promise<Output> {
    const examples = skill.resolvedExamples ?? [];
    const exEntry = examples.find((e) => e.name === input.name);

    if (!exEntry) {
      const availableNames = examples.map((e) => e.name);
      return {
        skillId: skill.id,
        skillName: skill.name,
        type: 'example',
        name: input.name,
        description: `Example "${input.name}" not found.`,
        content:
          availableNames.length > 0
            ? `Example "${input.name}" not found. Available examples: ${availableNames.join(', ')}`
            : `Skill "${skill.name}" has no examples.`,
        available: availableNames,
      };
    }

    const content = await this.readFileContent(instance, 'examples', exEntry.filename);
    const { frontmatter, body } = parseSkillMdFrontmatter(content);

    return {
      skillId: skill.id,
      skillName: skill.name,
      type: 'example',
      name: exEntry.name,
      description: exEntry.description,
      content: body,
      frontmatter: flattenFrontmatter(frontmatter),
      reference: exEntry.reference,
      level: exEntry.level,
    };
  }

  private async readFileContent(
    instance: SkillInstance,
    resourceType: 'references' | 'examples',
    filename: string,
  ): Promise<string> {
    const baseDir = instance.getBaseDir();
    const resources = instance.getResources();
    const resourcePath = resources?.[resourceType];

    if (!baseDir || !resourcePath) {
      this.fail(new Error(`Skill does not have a ${resourceType} directory configured.`));
    }

    const resourceDir = resourcePath.startsWith('/') ? resourcePath : pathResolve(baseDir, resourcePath);
    const filePath = pathResolve(resourceDir, filename);

    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      this.fail(
        new Error(`Failed to read ${resourceType} file "${filename}". The file may have been moved or deleted.`),
      );
    }
  }
}

/**
 * Flatten frontmatter values to string representation for the output schema.
 */
function flattenFrontmatter(fm: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fm)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}
