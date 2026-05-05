// file: libs/sdk/src/skill/sep-2640/resources/skill-file.resource.ts

import { type ReadResourceResult } from '@frontmcp/protocol';

import { ResourceTemplate } from '../../../common';
import { ResourceContext, type ResourceCompletionResult } from '../../../common/interfaces';
import { ResourceNotFoundError } from '../../../errors';
import type { SkillInstance } from '../../skill.instance';
import {
  findAndLoadSkillByPath,
  findSkillByPath,
  getSepVisibleSkills,
  readSkillFileByPath,
} from '../sep-2640.resource-helpers';

type Params = { skillPath: string; filePath: string };

/**
 * `skill://{+skillPath}/{+filePath}` — generic sub-file resource per SEP-2640.
 *
 * Exposes any file inside a skill directory: references, examples, scripts,
 * assets, top-level files like `LICENSE`, etc. The SKILL.md route is matched
 * by a more specific template (`Sep2640SkillMdResource`) and handled there;
 * this template covers everything else.
 *
 * Path traversal is blocked at the resolver layer
 * (`readSkillFileByPath`), and `..` / `.` segments in `filePath` are
 * rejected outright.
 */
@ResourceTemplate({
  name: 'sep2640-skill-file',
  uriTemplate: 'skill://{+skillPath}/{+filePath}',
  description:
    'Read any file inside a skill directory (references, examples, scripts, assets, ' +
    'top-level files) per MCP SEP-2640. Path traversal is rejected.',
})
export class Sep2640SkillFileResource extends ResourceContext<Params> {
  async skillPathCompleter(partial: string): Promise<ResourceCompletionResult> {
    const skills = getSepVisibleSkills(this.scope);
    const paths = skills.map((s) => s.getSkillPath());
    const filtered = partial ? paths.filter((p) => p.toLowerCase().startsWith(partial.toLowerCase())) : paths;
    return { values: filtered, total: filtered.length };
  }

  async filePathCompleter(partial: string): Promise<ResourceCompletionResult> {
    // We can't scope to a particular skill (MCP completion doesn't pass other
    // template variables yet), so collect file paths across all visible
    // skills. Filter by partial to keep the list small.
    const skills = getSepVisibleSkills(this.scope);
    const seen = new Set<string>();
    for (const skill of skills) {
      try {
        const content = await skill.load();
        for (const ref of content.resolvedReferences ?? []) {
          if (ref.filename) seen.add(`references/${ref.filename}`);
        }
        for (const ex of content.resolvedExamples ?? []) {
          if (ex.filename) seen.add(`examples/${ex.filename}`);
        }
      } catch {
        // skip unloadable skills
      }
    }
    const all = Array.from(seen).sort();
    const filtered = partial ? all.filter((p) => p.toLowerCase().startsWith(partial.toLowerCase())) : all;
    return { values: filtered, total: filtered.length };
  }

  async execute(uri: string, params: Params): Promise<ReadResourceResult> {
    // SKILL.md is served by a different (more specific) template. If a
    // request slips through here for SKILL.md, defer rather than serve the
    // wrong content.
    if (params.filePath === 'SKILL.md' || params.filePath.endsWith('/SKILL.md')) {
      throw new ResourceNotFoundError(uri);
    }

    // Find the instance to read from. We don't go through findAndLoadSkillByPath
    // because we don't need the SkillContent — only the base directory.
    const entry = findSkillByPath(this.scope, params.skillPath);
    if (!entry) {
      // Fallback: attempt a load to surface the same error users see for SKILL.md
      await findAndLoadSkillByPath(this.scope, params.skillPath);
      throw new ResourceNotFoundError(uri);
    }

    const instance = entry as SkillInstance;
    const { content, mimeType } = await readSkillFileByPath(instance, params.filePath);

    return {
      contents: [
        {
          uri,
          mimeType,
          text: content,
        },
      ],
    };
  }
}
