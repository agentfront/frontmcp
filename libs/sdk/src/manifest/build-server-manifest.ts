import { type EntryLineage, type EntryOwnerRef } from '../common/entries/base.entry';
import { type SkillEntry } from '../common/entries/skill.entry';
import { isEnabledSource, type EnabledOption } from '../common/metadata/enabled.metadata';
import { resolveToolVisibility } from '../common/metadata/tool.metadata';
import { resolveInstructionsBudget } from '../common/types/options/instructions-budget';
import { type Scope } from '../scope/scope.instance';
import { composeCallerInstructions } from '../skill/skill-instructions.helper';
import { computeSkillHash } from '../skill/sync/skill-hash';
import { hasUIConfig } from '../tool/ui/ui-shared';
import { ownerKeyOf } from '../utils/lineage.utils';
import {
  SERVER_MANIFEST_VERSION,
  type ManifestApp,
  type ManifestPrompt,
  type ManifestResource,
  type ManifestResourceTemplate,
  type ManifestSkill,
  type ManifestTool,
  type ServerManifest,
} from './server-manifest.schema';

interface OwnedEntry {
  owner: EntryOwnerRef;
  metadata: object;
}

interface LineageRegistry<Entry> {
  lineageOf(entry: Entry): EntryLineage | undefined;
}

/** An entry's owners without the scopes holding it: a scope only when it owns the entry itself. */
function ownersOf(lineage: EntryLineage | undefined, owner: EntryOwnerRef): EntryLineage {
  const owners = (lineage ?? []).filter((candidate) => candidate.kind !== 'scope');
  if (owners.length > 0) return owners;
  return lineage && lineage.length > 0 ? [lineage[lineage.length - 1]] : [owner];
}

/** Each entry once, with the owners the first scope holding it records. */
function entriesOf<Entry extends OwnedEntry>(
  scopes: readonly Scope[],
  registryOf: (scope: Scope) => LineageRegistry<Entry> & { listAllInstances(): readonly Entry[] },
): Array<{ entry: Entry; lineage: EntryLineage }> {
  const seen = new Set<Entry>();
  const found: Array<{ entry: Entry; lineage: EntryLineage }> = [];
  for (const scope of scopes) {
    const registry = registryOf(scope);
    for (const entry of registry.listAllInstances()) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      found.push({ entry, lineage: ownersOf(registry.lineageOf(entry), entry.owner) });
    }
  }
  return found;
}

/** `false` for an entry that is off, `'source'` for one an `EnabledSource` switches; nothing for one that is on. */
function enabledState(enabled: EnabledOption | undefined): false | 'source' | undefined {
  if (enabled === false) return false;
  return isEnabledSource(enabled) ? 'source' : undefined;
}

function ownedFields(lineage: EntryLineage, metadata: object) {
  const fields = metadata as { enabled?: EnabledOption; availableWhen?: object; authorities?: unknown };
  return {
    app: lineage.find((owner) => owner.kind === 'app')?.id,
    owner: ownerKeyOf(lineage),
    enabled: enabledState(fields.enabled),
    availableWhen: jsonObject(fields.availableWhen),
    authorities: fields.authorities === undefined ? undefined : (true as const),
  };
}

/** Metadata the manifest copies as it is: plain objects, which the final JSON round trip keeps. */
function jsonObject(value: object | undefined): Record<string, unknown> | undefined {
  return value as Record<string, unknown> | undefined;
}

function jsonObjects(values: readonly object[] | undefined): Array<Record<string, unknown>> | undefined {
  return values?.map((value) => value as Record<string, unknown>);
}

/** Sorted by plain string order, not the locale's, so every machine writes the same order. */
function sortedBy<T>(items: T[], key: (item: T) => string): T[] {
  return items.sort((left, right) => {
    const a = key(left);
    const b = key(right);
    if (a === b) return 0;
    return a < b ? -1 : 1;
  });
}

async function skillHash(skill: SkillEntry): Promise<string | undefined> {
  try {
    return computeSkillHash(await skill.load());
  } catch {
    return undefined;
  }
}

/**
 * The manifest of a server: every tool, resource, resource template, prompt and skill its scopes hold, whether or
 * not it is available, on or listed here, with the fields their listings need. Entries are sorted, and the
 * manifest is plain JSON, so the same server always gives the same manifest.
 */
export async function buildServerManifest(scopes: readonly Scope[], primary: Scope): Promise<ServerManifest> {
  const tools: ManifestTool[] = entriesOf(scopes, (scope) => scope.tools).map(({ entry: tool, lineage }) => ({
    name: tool.metadata.id ?? tool.metadata.name,
    title: tool.metadata.title,
    description: tool.metadata.description,
    ...ownedFields(lineage, tool.metadata),
    inputSchema: tool.getInputJsonSchema() ?? { type: 'object', properties: {} },
    outputSchema: tool.getOutputJsonSchema() ?? undefined,
    annotations: jsonObject(tool.metadata.annotations),
    icons: jsonObjects(tool.metadata.icons),
    _meta: tool.metadata._meta,
    tags: tool.metadata.tags,
    aliases: tool.metadata.aliases,
    visibility: resolveToolVisibility(tool.metadata),
    execution: jsonObject(tool.metadata.execution),
    output: jsonObject(tool.metadata.output),
    examples: jsonObjects(tool.metadata.examples),
    ui: hasUIConfig(tool.metadata) ? true : undefined,
  }));

  const resources: ManifestResource[] = [];
  const resourceTemplates: ManifestResourceTemplate[] = [];
  for (const { entry: resource, lineage } of entriesOf(scopes, (scope) => scope.resources)) {
    const metadata = resource.metadata;
    const fields = {
      name: metadata.name,
      title: metadata.title,
      description: metadata.description,
      mimeType: metadata.mimeType,
      icons: jsonObjects(metadata.icons),
      annotations: jsonObject(metadata.annotations),
      _meta: metadata._meta,
      ...ownedFields(lineage, metadata),
    };
    if (resource.isTemplate && resource.uriTemplate) {
      resourceTemplates.push({ uriTemplate: resource.uriTemplate, ...fields });
    } else if (resource.uri) {
      resources.push({ uri: resource.uri, ...fields });
    }
  }

  const prompts: ManifestPrompt[] = entriesOf(scopes, (scope) => scope.prompts).map(({ entry: prompt, lineage }) => ({
    name: prompt.metadata.name,
    title: prompt.metadata.title,
    description: prompt.metadata.description,
    ...ownedFields(lineage, prompt.metadata),
    arguments: prompt.metadata.arguments,
    icons: jsonObjects(prompt.metadata.icons),
  }));

  const skills: ManifestSkill[] = await Promise.all(
    entriesOf(scopes, (scope) => scope.skills).map(async ({ entry: skill, lineage }) => ({
      name: skill.metadata.name,
      path: skill.getSkillPath(),
      description: skill.getDescription(),
      ...ownedFields(lineage, skill.metadata),
      tags: skill.metadata.tags,
      visibility: skill.metadata.visibility ?? 'both',
      hidden: skill.isHidden() ? (true as const) : undefined,
      tools: skill.getToolRefs().map(({ name, purpose, required }) => ({ name, purpose, required })),
      license: skill.getLicense(),
      hash: await skillHash(skill),
    })),
  );

  const apps = new Map<string, ManifestApp>();
  for (const scope of scopes) {
    for (const app of scope.apps.getApps()) {
      if (apps.has(app.id)) continue;
      const metadata = app.metadata as { name: string; description?: string; standalone?: ManifestApp['standalone'] };
      apps.set(app.id, {
        id: app.id,
        name: metadata.name,
        description: metadata.description,
        remote: app.isRemote ? true : undefined,
        standalone: metadata.standalone || undefined,
        output: jsonObject((app.metadata as { output?: object }).output),
      });
    }
  }

  const instructions = await composeCallerInstructions(primary, { skillUriHints: true });
  const manifest: ServerManifest = {
    manifestVersion: SERVER_MANIFEST_VERSION,
    server: {
      name: primary.metadata.info.name,
      version: primary.metadata.info.version,
      title: primary.metadata.info.title,
      instructions: instructions.length > 0 ? instructions : undefined,
    },
    budget: resolveInstructionsBudget(primary.metadata.instructionsBudget),
    apps: sortedBy([...apps.values()], (app) => app.id),
    tools: sortedBy(tools, (tool) => `${tool.name}\0${tool.owner}`),
    resources: sortedBy(resources, (resource) => `${resource.uri}\0${resource.owner}`),
    resourceTemplates: sortedBy(resourceTemplates, (template) => `${template.uriTemplate}\0${template.owner}`),
    prompts: sortedBy(prompts, (prompt) => `${prompt.name}\0${prompt.owner}`),
    skills: sortedBy(skills, (skill) => `${skill.path}\0${skill.owner}`),
  };
  return JSON.parse(JSON.stringify(manifest)) as ServerManifest;
}
