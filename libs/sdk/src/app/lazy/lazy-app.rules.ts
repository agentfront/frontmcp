import type { HookEntry } from '../../common/entries/hook.entry';
import type { PromptEntry } from '../../common/entries/prompt.entry';
import type { ResourceEntry } from '../../common/entries/resource.entry';
import type { ToolEntry } from '../../common/entries/tool.entry';
import type { PluginType } from '../../common/interfaces/plugin.interface';
import type { LocalAppMetadata } from '../../common/metadata/app.metadata';
import { isEnabledSource, type EnabledOption } from '../../common/metadata/enabled.metadata';
import { isEnforcementRequested } from '../../common/utils/enforced-metadata.utils';
import { hookClassOf } from '../../hooks/hook.registry';
import { normalizePlugin } from '../../plugin/plugin.utils';
import { hasUIConfig } from '../../tool/ui/ui-shared';
import type { ListedApp } from './lazy-manifest';

/** The loaded entries of an app, as its registries hold them, with the hooks and duties its initialization set up. */
export interface LoadedEntries {
  tools: readonly ToolEntry[];
  resources: readonly ResourceEntry[];
  prompts: readonly PromptEntry[];
  skills: readonly { readonly name: string }[];
  agents: readonly { readonly name: string }[];
  /** The flow hooks the app owns. */
  hooks: readonly HookEntry[];
  /** Its `@Duty` providers. */
  duties: readonly { readonly name: string }[];
}

/** The flows that run an app's hooks only for its own entries; hooks on any other flow run for every request. */
const ENTRY_CALL_FLOWS: ReadonlySet<string> = new Set([
  'tools:call-tool',
  'resources:read-resource',
  'prompts:get-prompt',
  'completion:complete',
]);

/** Entry metadata FrontMCP's plugins read without calling the entry (the lists, CodeCall), which no manifest records. */
const READ_BEFORE_THE_CALL = ['featureFlag', 'codecall'] as const;

/** What of an entry only its code can decide for a listing. */
interface EntryFacts {
  label: string;
  authorities: boolean;
  ownEnabledSource: boolean;
  widget: boolean;
  readBeforeTheCall?: readonly string[];
}

function reasonsOf(entries: readonly EntryFacts[]): string[] {
  return entries.flatMap(({ label, authorities, ownEnabledSource, widget, readBeforeTheCall = [] }) => [
    ...(authorities ? [`${label} declares authorities`] : []),
    ...(ownEnabledSource ? [`${label} has an enabled source of its own (give the lazy app the switch instead)`] : []),
    ...(widget ? [`${label} has a widget (ui)`] : []),
    ...readBeforeTheCall.map((key) => `${label} declares '${key}', which a plugin reads from its placeholder`),
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

/** Why an imported app's own metadata keeps it from being lazy, read before its code initializes; empty when it can. */
export function whyAppCannotBeLazy(metadata: LocalAppMetadata): string[] {
  const reasons: string[] = [];
  for (const key of ['jobs', 'workflows', 'channels'] as const) {
    if (metadata[key]?.length) reasons.push(`it declares ${key}`);
  }
  if (metadata.auth) reasons.push('it declares its own auth');
  if (metadata.standalone) reasons.push("it is standalone (a lazy app joins the server's scope)");
  if (metadata.ui) reasons.push('it declares ui defaults');
  for (const name of serverScopedPluginsOf(metadata.plugins ?? [])) {
    reasons.push(`plugin "${name}" has scope 'server' (its hooks would guard no other app until this one is imported)`);
  }
  return reasons;
}

function serverScopedPluginsOf(plugins: readonly PluginType[]): string[] {
  return plugins.flatMap((plugin) => {
    const { metadata } = normalizePlugin(plugin);
    const nested = serverScopedPluginsOf(metadata.plugins ?? []);
    return metadata.scope === 'server' ? [metadata.name, ...nested] : nested;
  });
}

/** Why a loaded app cannot be lazy: what only startup sets up, or what only its code can list; empty when it can. */
export function whyLoadedAppCannotBeLazy(entries: LoadedEntries): string[] {
  const names = (list: readonly { readonly name: string }[]) => list.map(({ name }) => `"${name}"`).join(', ');
  const reasons: string[] = [];
  if (entries.skills.length > 0) reasons.push(`it has skills (${names(entries.skills)})`);
  if (entries.agents.length > 0) reasons.push(`it has agents (${names(entries.agents)})`);
  if (entries.duties.length > 0) reasons.push(`it has duties (${names(entries.duties)}), which start with the server`);
  for (const hook of entries.hooks) {
    const label = `${hook.metadata.pluginName ?? classNameOf(hook)}.${hook.metadata.method}`;
    if (!ENTRY_CALL_FLOWS.has(hook.metadata.flow)) {
      reasons.push(`the hook ${label} is on ${hook.metadata.flow}, which runs it for every app`);
    } else if (hook.metadata.appliesTo === 'all-apps') {
      reasons.push(`the hook ${label} applies to all apps`);
    }
  }

  const facts = (
    label: string,
    entry: { authorities?: unknown; enabled?: EnabledOption },
    widget = false,
  ): EntryFacts => ({
    label,
    authorities: entry.authorities !== undefined,
    ownEnabledSource: isEnabledSource(entry.enabled),
    widget,
    readBeforeTheCall: READ_BEFORE_THE_CALL.filter((key) =>
      isEnforcementRequested((entry as Record<string, unknown>)[key]),
    ),
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

function classNameOf(hook: HookEntry): string {
  const cls = hookClassOf(hook);
  return typeof cls === 'function' && cls.name ? cls.name : 'an anonymous class';
}
