import { type SkillMetadata } from '../../common/metadata';
import { PublicMcpError } from '../../errors';
import { filterDiscoverableSkillResults } from '../../skill/skill-filter.helper';
import { type SkillListOptions } from '../../skill/skill-storage.interface';
import { type SkillRegistryInterface } from '../../skill/skill.registry';
import { type McpHandler, type McpHandlerOptions } from './mcp-handlers.types';
import { withMcpSurface } from './mcp-surface';
import {
  SkillsListRequestSchema,
  SkillsListResultSchema,
  type SkillsListRequest,
  type SkillsListResult,
} from './skills-mcp.types';

/** Page size used when a request names no `limit` (the skill providers' default). */
const DEFAULT_PAGE_SIZE = 50;

/** Size of the first registry read: the largest page a `skills/list` request may ask for. */
const REGISTRY_PAGE_SIZE = 100;

/**
 * Every skill the registry lists for these options, so the caller's page can be cut after the
 * skills the caller can't discover are removed.
 *
 * The first read reports the total; the next asks for all the rest at once, so a provider that
 * sorts its whole catalog per call does so twice, not once per 100 skills. A provider that caps
 * its page size returns less, and the loop reads on from where it stopped.
 */
async function listAllMatching(
  registry: SkillRegistryInterface,
  options: Omit<SkillListOptions, 'offset' | 'limit'>,
): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];
  let limit = REGISTRY_PAGE_SIZE;
  for (;;) {
    const page = await registry.listSkills({ ...options, offset: skills.length, limit });
    skills.push(...page.skills);
    if (!page.hasMore || page.skills.length === 0 || skills.length >= page.total) return skills;
    limit = Math.max(REGISTRY_PAGE_SIZE, page.total - skills.length);
  }
}

/**
 * MCP handler for skills/list custom method.
 *
 * Allows MCP clients to list all available skills.
 */
export default function skillsListRequestHandler({
  scope,
}: McpHandlerOptions): McpHandler<SkillsListRequest, SkillsListResult> {
  const logger = scope.logger.child('skills-list-request-handler');

  return {
    requestSchema: SkillsListRequestSchema,
    responseSchema: SkillsListResultSchema,
    handler: async (request: SkillsListRequest, ctx) => {
      const params = request.params ?? {};
      const { offset, limit, tags, sortBy, sortOrder, includeHidden } = params;
      logger.verbose(`skills/list: offset=${offset}, limit=${limit}`);

      const skillRegistry = scope.skills;
      if (!skillRegistry) {
        throw new PublicMcpError('Skills capability not available', 'CAPABILITY_NOT_AVAILABLE', 501);
      }

      // Remove the skills the caller can't discover (entry-level authorities, surface, then the
      // `skills:filter` flow) from the whole matching catalog before cutting the page. Filtering a
      // page after the fact let hidden skills take page slots, and its `total` counted the hidden
      // skills on every other page.
      const matching = await listAllMatching(skillRegistry, { tags, sortBy, sortOrder, includeHidden });
      const authInfo = (ctx?.authInfo ?? {}) as Record<string, unknown>;
      const visible = await filterDiscoverableSkillResults(
        scope,
        skillRegistry,
        matching.map((metadata) => ({ metadata })),
        { authInfo, ctx: withMcpSurface(scope, ctx) },
      );

      const start = offset ?? 0;
      const page = visible.slice(start, start + (limit ?? DEFAULT_PAGE_SIZE));

      // Transform to response format
      const skills = page.map(({ metadata: s }) => ({
        id: s.id ?? s.name,
        name: s.name,
        description: s.description ?? '',
        tags: s.tags,
        priority: s.priority,
      }));

      const result = {
        skills,
        total: visible.length,
        hasMore: start + page.length < visible.length,
      };

      // Validate result against schema
      return SkillsListResultSchema.parse(result);
    },
  };
}
