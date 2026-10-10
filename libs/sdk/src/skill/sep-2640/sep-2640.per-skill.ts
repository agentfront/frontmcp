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
 * MCP-visible skill, at scope startup and whenever skills are added or removed.
 * These show up in `resources/list` with frontmatter-derived metadata plus
 * `audience`/`priority` annotations.
 *
 * When the skill served at a path is replaced, the resource takes the new
 * skill's description and policy metadata, so `resources/list` gates it by
 * the skill it now serves rather than the one it was created for.
 */

import { type ReadResourceResult } from '@frontmcp/protocol';

import {
  FrontMcpResourceTokens,
  FrontMcpSkillTokens,
  type FrontMcpLogger,
  type ResourceFunctionRecord,
  type ResourceMetadata,
  type ScopeEntry,
  type SkillEntry,
} from '../../common';
import { ResourceKind } from '../../common/records/resource.record';
import type ResourceRegistry from '../../resource/resource.registry';
import type { SkillRegistryInterface } from '../skill.registry';
import { serializeSkillMd } from './sep-2640.builders';
import { SEP_2640_META_NAMESPACE, SKILL_MD_MIME_TYPE, SKILL_MD_PRIORITY } from './sep-2640.constants';
import { findAndLoadSkillByPath } from './sep-2640.resource-helpers';
import { buildSkillUri } from './sep-2640.uri';

/**
 * The metadata extensions contributed to the skill (`authorities`, a plugin's `featureFlag`, ...).
 *
 * The per-skill resource carries them so the resource flows gate it exactly like its skill:
 * `checkEntryAuthorities` and `filterByAuthorities`, and every plugin hook that reads the key from
 * resource metadata. Core skill fields and keys the resource sets itself are never copied.
 */
function skillExtensionMetadata(skill: SkillEntry): Record<string, unknown> {
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(skill.metadata)) {
    if (value === undefined || key in FrontMcpSkillTokens || key in FrontMcpResourceTokens) continue;
    extensions[key] = value;
  }
  return extensions;
}

/**
 * Build a `ResourceFunctionRecord` for a single skill. The function reads
 * the skill via `findAndLoadSkillByPath` and emits raw SKILL.md.
 *
 * The record carries SEP-conformant metadata:
 *   - `name` = skill's frontmatter name
 *   - `description` = skill's frontmatter description (what a `build()` override returns, once loaded)
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
    ...skillExtensionMetadata(skill),
    uri,
    name: skill.metadata.name,
    description: skill.getDescription(),
    mimeType: SKILL_MD_MIME_TYPE,
    annotations,
    _meta: meta,
    // The skill's own `availableWhen`, so `resources/list` and `resources/read` offer its SKILL.md
    // on the surfaces that offer the skill, and answer others as for an unknown resource.
    ...(skill.metadata.availableWhen !== undefined && { availableWhen: skill.metadata.availableWhen }),
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
 *
 * The resources follow the skill registry: a skill registered after startup gets its resource, one
 * that is removed loses it, and a replaced skill's resource takes the new skill's metadata.
 */
export async function registerPerSkillResources(options: {
  scope: ScopeEntry;
  skillRegistry: Pick<SkillRegistryInterface, 'getSkills' | 'subscribe'>;
  resourceRegistry: ResourceRegistry;
  logger: FrontMcpLogger;
  resolveLastModified?: (skill: SkillEntry) => Promise<string | undefined>;
}): Promise<void> {
  const { scope, skillRegistry, resourceRegistry, logger, resolveLastModified } = options;
  const registered = new Map<string, PerSkillResource>();

  const register = (skill: SkillEntry): Promise<void> => {
    try {
      const record = buildPerSkillResourceRecord(scope, skill);
      // The resource registry's dynamic-register path accepts a normalised
      // record directly.
      resourceRegistry.registerDynamicResource(record);
      registered.set(skill.getSkillPath(), {
        token: record.provide,
        metadata: record.metadata as unknown as Record<string, unknown>,
        extensionKeys: Object.keys(skillExtensionMetadata(skill)),
      });
      logger.verbose(`Registered SEP-2640 per-skill resource: ${record.metadata.uri}`);
      return resolveLastModified
        ? addLastModified(record.metadata, skill, resolveLastModified, logger)
        : Promise.resolve();
    } catch (err) {
      logger.warn(
        `Failed to register SEP-2640 per-skill resource for "${skill.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return Promise.resolve();
    }
  };

  // Synchronous, so two registry changes never register one path twice.
  const reconcile = (): Promise<void>[] => {
    const served = servedSkillsByPath(skillRegistry);
    for (const [skillPath, resource] of registered) {
      if (served.has(skillPath)) continue;
      resourceRegistry.unregisterResourceInstance(resource.token);
      registered.delete(skillPath);
    }
    const lastModifiedUpdates: Promise<void>[] = [];
    for (const [skillPath, skill] of served) {
      const resource = registered.get(skillPath);
      if (resource) refreshFromSkill(resource, skill);
      else lastModifiedUpdates.push(register(skill));
    }
    return lastModifiedUpdates;
  };

  await Promise.all(reconcile());
  skillRegistry.subscribe({ immediate: false }, () => {
    reconcile();
  });
}

/**
 * Add `annotations.lastModified` to a registered resource's metadata (the instance holds the object).
 * A failure is only logged: `lastModified` is a cache hint, not load-bearing.
 */
async function addLastModified(
  metadata: ResourceMetadata,
  skill: SkillEntry,
  resolveLastModified: (skill: SkillEntry) => Promise<string | undefined>,
  logger: FrontMcpLogger,
): Promise<void> {
  try {
    const lastModified = await resolveLastModified(skill);
    if (lastModified && metadata.annotations) metadata.annotations.lastModified = lastModified;
  } catch (err) {
    logger.warn(
      `Failed to resolve SEP-2640 lastModified for "${skill.name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** A registered per-skill resource and the skill metadata it copied. */
interface PerSkillResource {
  token: ResourceFunctionRecord['provide'];
  metadata: Record<string, unknown>;
  extensionKeys: string[];
}

/** The skill each `<skill-path>` serves, resolved as `findSkillByPath` does (first MCP-visible match). */
function servedSkillsByPath(skillRegistry: Pick<SkillRegistryInterface, 'getSkills'>): Map<string, SkillEntry> {
  const served = new Map<string, SkillEntry>();
  for (const skill of skillRegistry.getSkills({ visibility: 'mcp' })) {
    const skillPath = skill.getSkillPath();
    if (!served.has(skillPath)) served.set(skillPath, skill);
  }
  return served;
}

/** Copy the description, availability and policy metadata of the skill now served at the resource's path. */
function refreshFromSkill(resource: PerSkillResource, skill: SkillEntry): void {
  const extensions = skillExtensionMetadata(skill);
  for (const key of resource.extensionKeys) {
    if (!(key in extensions)) Reflect.deleteProperty(resource.metadata, key);
  }
  Object.assign(resource.metadata, extensions);
  resource.metadata['description'] = skill.getDescription();
  if (skill.metadata.availableWhen === undefined) Reflect.deleteProperty(resource.metadata, 'availableWhen');
  else resource.metadata['availableWhen'] = skill.metadata.availableWhen;
  resource.extensionKeys = Object.keys(extensions);
}
