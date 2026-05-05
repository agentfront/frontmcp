// file: libs/sdk/src/skill/sep-2640/sep-2640.per-skill.ts

/**
 * Per-skill concrete Resource registration for SEP-2640 conformance.
 *
 * The `Sep2640SkillMdResource` template handles `resources/read` for any
 * matching URI, but the SEP §Resource Metadata also says:
 *
 * > For each `skill://<skill-path>/SKILL.md` resource:
 * > - `name` SHOULD be set from the `name` field of the SKILL.md YAML frontmatter.
 * > - `description` SHOULD be set from the `description` field.
 *
 * To satisfy that, we additionally register one **concrete** `Resource` per
 * MCP-visible skill at scope startup. These show up in `resources/list`
 * with frontmatter-derived metadata plus `audience`/`priority` annotations.
 */

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  type FrontMcpLogger,
  type ResourceFunctionRecord,
  type ResourceMetadata,
  type ScopeEntry,
  type SkillEntry,
} from '../../common';
import { ResourceKind } from '../../common/records/resource.record';
import type ResourceRegistry from '../../resource/resource.registry';
import { serializeSkillMd } from './sep-2640.builders';
import { SEP_2640_META_NAMESPACE, SKILL_MD_MIME_TYPE, SKILL_MD_PRIORITY } from './sep-2640.constants';
import { findAndLoadSkillByPath } from './sep-2640.resource-helpers';
import { buildSkillUri } from './sep-2640.uri';

/**
 * Build a `ResourceFunctionRecord` for a single skill. The function reads
 * the skill via `findAndLoadSkillByPath` and emits raw SKILL.md.
 *
 * The record carries SEP-conformant metadata:
 *   - `name` = skill's frontmatter name
 *   - `description` = skill's frontmatter description
 *   - `mimeType` = `text/markdown`
 *   - `annotations.audience` = `["assistant"]`
 *   - `annotations.priority` = 0.8 (the SEP-recommended SKILL.md priority)
 *   - `annotations.lastModified` (when supplied — populated for file-backed skills)
 *   - `_meta.io.modelcontextprotocol.skills/path` = the skill's `<skill-path>`
 *
 * The function is bound to the scope so `resources/read` invocation
 * resolves through the active SkillRegistry.
 */
export function buildPerSkillResourceRecord(
  scope: ScopeEntry,
  skill: SkillEntry,
  opts: { lastModified?: string } = {},
): ResourceFunctionRecord {
  const skillPathSegments = skill.getSkillPathSegments();
  const skillPath = skillPathSegments.join('/');
  const uri = buildSkillUri(skillPathSegments, 'SKILL.md');

  const annotations: ResourceMetadata['annotations'] = {
    audience: ['assistant'],
    priority: SKILL_MD_PRIORITY,
  };
  if (opts.lastModified) {
    annotations.lastModified = opts.lastModified;
  }

  const meta: Record<string, unknown> = {
    [`${SEP_2640_META_NAMESPACE}path`]: skillPath,
  };

  const metadata: ResourceMetadata = {
    uri,
    name: skill.metadata.name,
    description: skill.metadata.description,
    mimeType: SKILL_MD_MIME_TYPE,
    annotations,
    _meta: meta,
  };

  // The handler signature matches what the resource registry expects: a
  // function that returns a `ReadResourceResult`. We close over `scope` so
  // resolution always uses the live SkillRegistry — supporting hot-swap
  // without re-registering the resource.
  const handler = async (): Promise<ReadResourceResult> => {
    const { loadResult } = await findAndLoadSkillByPath(scope, skillPath);
    return {
      contents: [
        {
          uri,
          mimeType: SKILL_MD_MIME_TYPE,
          text: serializeSkillMd(loadResult.skill),
        },
      ],
    };
  };

  return {
    kind: ResourceKind.FUNCTION,
    provide: handler,
    metadata,
  };
}

/**
 * Register one concrete `Resource` per MCP-visible skill so
 * `resources/list` returns SEP-conformant entries (frontmatter-derived
 * `name`/`description`, audience/priority annotations).
 *
 * This is in addition to — not a replacement for — the SKILL.md template
 * (`Sep2640SkillMdResource`). Hosts may discover skills either via
 * `resources/list` (concrete) or `skill://index.json` (discovery doc).
 */
export async function registerPerSkillResources(options: {
  scope: ScopeEntry;
  resourceRegistry: ResourceRegistry;
  skills: SkillEntry[];
  logger: FrontMcpLogger;
  resolveLastModified?: (skill: SkillEntry) => Promise<string | undefined>;
}): Promise<void> {
  const { scope, resourceRegistry, skills, logger, resolveLastModified } = options;

  for (const skill of skills) {
    // Resolve `lastModified` in its own try/catch so a flaky stat doesn't
    // suppress the resource registration itself — `lastModified` is just
    // a cache hint, not load-bearing.
    let lastModified: string | undefined;
    if (resolveLastModified) {
      try {
        lastModified = await resolveLastModified(skill);
      } catch (err) {
        logger.warn(
          `Failed to resolve SEP-2640 lastModified for "${skill.name}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    try {
      const record = buildPerSkillResourceRecord(scope, skill, { lastModified });
      // The resource registry's dynamic-register path accepts a normalised
      // record directly.
      resourceRegistry.registerDynamicResource(record);
      logger.verbose(`Registered SEP-2640 per-skill resource: ${record.metadata.uri}`);
    } catch (err) {
      logger.warn(
        `Failed to register SEP-2640 per-skill resource for "${skill.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
