// file: libs/sdk/src/skill/sep-2640/resources/skill-index.resource.ts

import { type ReadResourceResult } from '@frontmcp/protocol';

import { Resource } from '../../../common';
import { ResourceContext } from '../../../common/interfaces';
import { filterSkillsByAuthorities } from '../../skill-authorities.helper';
import { buildResourceTemplateIndexEntry, buildSkillIndex, buildSkillMdIndexEntry } from '../sep-2640.builders';
import { SKILL_INDEX_MIME_TYPE, SKILL_INDEX_URI } from '../sep-2640.constants';
import { getSepVisibleSkills } from '../sep-2640.resource-helpers';

/**
 * `skill://index.json` — the SEP-2640 well-known discovery resource.
 *
 * Mirrors the agentskills.io discovery RFC v0.2.0 shape:
 *
 * ```json
 * {
 *   "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
 *   "skills": [
 *     {
 *       "name": "git-workflow",
 *       "type": "skill-md",
 *       "description": "...",
 *       "url": "skill://git-workflow/SKILL.md"
 *     }
 *   ]
 * }
 * ```
 *
 * Per SEP-2640 §Discovery, hosts MUST NOT treat an absent or empty index
 * as proof that a server has no skills — direct readability via
 * `resources/read` is the baseline.
 */
@Resource({
  name: 'sep2640-skill-index',
  uri: SKILL_INDEX_URI,
  description:
    'SEP-2640 skill discovery index. Lists every MCP-visible skill with its name, ' +
    'description, and full skill:// URI. Resource templates and archive entries may ' +
    'also appear when configured.',
  mimeType: SKILL_INDEX_MIME_TYPE,
})
export class Sep2640SkillIndexResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    // Hide skills the caller is not authorized to discover (mirrors
    // `filterByAuthorities` for tools/resources). Skills without `authorities`
    // always pass; when no authorities engine is configured the list is
    // returned unchanged.
    const visible = getSepVisibleSkills(this.scope);
    const skills = await filterSkillsByAuthorities(this.scope, visible, this.getAuthInfo() as Record<string, unknown>);

    const entries = skills.map((skill) =>
      buildSkillMdIndexEntry({
        name: skill.metadata.name,
        description: skill.metadata.description,
        skillPathSegments: skill.getSkillPathSegments(),
      }),
    );

    // SEP-2640 §Discovery: when concrete `skill-md` entries exist we also
    // surface the SKILL.md template itself as an `mcp-resource-template`
    // entry. This lets hosts that prefer the template + completion-API
    // discovery path (rather than enumerating every concrete entry) wire
    // their UI to the same URI shape we serve.
    if (skills.length > 0) {
      entries.push(
        buildResourceTemplateIndexEntry(
          'Read the raw SKILL.md (frontmatter + body) for any skill served by this MCP server.',
          'skill://{+skillPath}/SKILL.md',
        ),
      );
    }

    // Append optional resource-template entries declared on the SkillRegistry
    const registry = this.scope.skills;
    const templates = registry?.getSep2640IndexTemplates?.() ?? [];
    for (const tpl of templates) {
      entries.push(tpl);
    }

    // Append optional archive entries (Phase 3).
    const archives = registry?.getSep2640IndexArchives?.() ?? [];
    for (const arc of archives) {
      entries.push(arc);
    }

    const document = buildSkillIndex(entries);

    return {
      contents: [
        {
          uri,
          mimeType: SKILL_INDEX_MIME_TYPE,
          text: JSON.stringify(document, null, 2),
        },
      ],
    };
  }
}
