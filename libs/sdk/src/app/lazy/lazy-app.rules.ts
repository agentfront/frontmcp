import type { PromptEntry } from '../../common/entries/prompt.entry';
import type { ResourceEntry } from '../../common/entries/resource.entry';
import type { ToolEntry } from '../../common/entries/tool.entry';
import type { LocalAppMetadata } from '../../common/metadata/app.metadata';
import { isEnabledSource, type EnabledOption } from '../../common/metadata/enabled.metadata';
import { hasUIConfig } from '../../tool/ui/ui-shared';
import type { ListedApp } from './lazy-manifest';

/** The loaded entries of an app, as its registries hold them. */
export interface LoadedEntries {
  tools: readonly ToolEntry[];
  resources: readonly ResourceEntry[];
  prompts: readonly PromptEntry[];
  skills: readonly { readonly name: string }[];
  agents: readonly { readonly name: string }[];
}

/** What of an entry only its code can decide for a listing. */
interface EntryFacts {
  label: string;
  authorities: boolean;
  ownEnabledSource: boolean;
  widget: boolean;
}

function reasonsOf(entries: readonly EntryFacts[]): string[] {
  return entries.flatMap(({ label, authorities, ownEnabledSource, widget }) => [
    ...(authorities ? [`${label} declares authorities`] : []),
    ...(ownEnabledSource ? [`${label} has an enabled source of its own (give the lazy app the switch instead)`] : []),
    ...(widget ? [`${label} has a widget (ui)`] : []),
  ]);
}

/** Why what the manifest lists for an app cannot be listed without its code; empty when it can. */
export function whyListedAppCannotBeLazy(listed: ListedApp): string[] {
  const facts = (label: string, entry: { authorities?: true; enabled?: false | 'source'; ui?: true }): EntryFacts => ({
    label,
    authorities: entry.authorities === true,
    ownEnabledSource: entry.enabled === 'source',
    widget: entry.ui === true,
  });
  return [
    ...listed.skills.map((skill) => `the manifest lists skill "${skill.name}" for it`),
    ...reasonsOf([
      ...listed.tools.map((tool) => facts(`tool "${tool.name}"`, tool)),
      ...listed.resources.map((resource) => facts(`resource "${resource.uri}"`, resource)),
      ...listed.resourceTemplates.map((template) => facts(`resource template "${template.uriTemplate}"`, template)),
      ...listed.prompts.map((prompt) => facts(`prompt "${prompt.name}"`, prompt)),
    ]),
  ];
}

/** Why a loaded app cannot be lazy: what only startup sets up, or what only its code can list; empty when it can. */
export function whyLoadedAppCannotBeLazy(metadata: LocalAppMetadata, entries: LoadedEntries): string[] {
  const reasons: string[] = [];
  for (const key of ['jobs', 'workflows', 'channels'] as const) {
    if (metadata[key]?.length) reasons.push(`it declares ${key}`);
  }
  if (metadata.auth) reasons.push('it declares its own auth');
  if (metadata.standalone) reasons.push("it is standalone (a lazy app joins the server's scope)");
  if (metadata.ui) reasons.push('it declares ui defaults');
  const names = (list: readonly { readonly name: string }[]) => list.map(({ name }) => `"${name}"`).join(', ');
  if (entries.skills.length > 0) reasons.push(`it has skills (${names(entries.skills)})`);
  if (entries.agents.length > 0) reasons.push(`it has agents (${names(entries.agents)})`);

  const facts = (
    label: string,
    entry: { authorities?: unknown; enabled?: EnabledOption },
    widget = false,
  ): EntryFacts => ({
    label,
    authorities: entry.authorities !== undefined,
    ownEnabledSource: isEnabledSource(entry.enabled),
    widget,
  });
  return [
    ...reasons,
    ...reasonsOf([
      ...entries.tools.map((tool) => facts(`tool "${tool.name}"`, tool.metadata, hasUIConfig(tool.metadata))),
      ...entries.resources.map((resource) =>
        facts(
          resource.isTemplate ? `resource template "${resource.uriTemplate}"` : `resource "${resource.uri}"`,
          resource.metadata,
        ),
      ),
      ...entries.prompts.map((prompt) => facts(`prompt "${prompt.name}"`, prompt.metadata)),
    ]),
  ];
}
