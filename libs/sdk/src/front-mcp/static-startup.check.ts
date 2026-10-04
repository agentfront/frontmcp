// file: libs/sdk/src/front-mcp/static-startup.check.ts

/**
 * The startup checks that need nothing but a server config's metadata.
 *
 * Every scope runs the full startup checks while it is built (`Scope.validateAuthoritiesConfig`,
 * `findUnenforcedMetadata`), so an entry point that builds the server where it is created refuses a
 * misconfigured one there. An entry point that has to defer the build can't: on an edge isolate
 * (Cloudflare Workers, Vercel Edge, Deno) module evaluation forbids the timers, randomness and I/O
 * building does, and a Worker's secrets only arrive with its first request. Such an entry point runs
 * these checks where it is created instead, so what the metadata alone shows still stops the server
 * there, and the full checks run when the server is built.
 *
 * They refuse only what the full checks certainly refuse too:
 * - an entry declares `authorities` and the server has no `authorities` option;
 * - an entry declares a field only a plugin enforces (`approval`, `featureFlag`, ...) and no plugin
 *   that reaches it enforces it. Outside an agent, a plugin enforces the fields it declares only
 *   through its hooks, so one without hooks enforces none. The server's plugins reach every entry.
 *   An app's plugins reach its entries, and other apps' too when one of their hooks is
 *   `appliesTo: 'uncovered-apps'` or their hooks can't be read here. Skills, and entries outside
 *   every app, are reached by every plugin outside an agent. A tool declared inside an `@Agent` is
 *   reached only by that agent's plugins (by none with `execution.useToolFlow: false`), and an
 *   agent's plugins reach nothing else.
 *
 * Entries the config names are read from their decorators. An entry whose `availableWhen` depends on
 * the process (os, runtime, env, ...) is left to the full checks, as are entries only the built server
 * knows (from adapters, remote or ESM apps, or plugin code).
 */

import { normalizeAgent } from '../agent/agent.utils';
import { normalizeApp } from '../app/app.utils';
import {
  AppKind,
  PluginKind,
  type FrontMcpConfigInput,
  type FrontMcpConfigType,
  type HookMetadata,
  type PluginRecord,
} from '../common';
import { peekPendingTC39HooksForClass } from '../common/decorators/hook.decorator';
import {
  describeMetadataEnforcer,
  getEnforcedMetadataKeys,
  isEnforcementRequested,
} from '../common/utils/enforced-metadata.utils';
import { AuthConfigurationError, UnenforcedMetadataError } from '../errors';
import { collectHook } from '../hooks/hooks.utils';
import { normalizePlugin } from '../plugin/plugin.utils';
import { normalizePrompt } from '../prompt/prompt.utils';
import { isResourceTemplate, normalizeResource, normalizeResourceTemplate } from '../resource/resource.utils';
import { normalizeSkill } from '../skill/skill.utils';
import { normalizeTool } from '../tool/tool.utils';

/** An entry the config names, labelled as the full checks label it. */
interface StaticEntry {
  label: string;
  metadata: Record<string, unknown>;
  /** The keys the plugins that reach the entry enforce. */
  enforcedBy: ReadonlySet<string>;
}

/**
 * Whose plugins' hooks the flow that gates an entry runs: an agent's alone for its own tools, an
 * app's (and those that reach every app) for its entries, every plugin's for the rest.
 */
type EntryReach = { agentKeys: ReadonlySet<string> } | { app: object } | 'every-plugin';

/** The entry lists of a server, an app or a plugin. */
interface EntryLists {
  tools?: readonly unknown[];
  resources?: readonly unknown[];
  prompts?: readonly unknown[];
  agents?: readonly unknown[];
  skills?: readonly unknown[];
  plugins?: readonly unknown[];
}

/** The record `normalize` makes, or undefined for an item only building the server can judge. */
function tryNormalize<T>(normalize: () => T): T | undefined {
  try {
    return normalize();
  } catch {
    return undefined;
  }
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/** Whether every process serves the entry: its `availableWhen`, if any, only names callers (`surface`). */
function isServedEverywhere(metadata: Record<string, unknown>): boolean {
  const availability = asMetadata(metadata['availableWhen']);
  if (!availability) return true;
  return Object.entries(availability).every(
    ([axis, value]) => value === undefined || (axis === 'surface' && Array.isArray(value) && value.length > 0),
  );
}

/** The class whose instance the server builds for a plugin, when its record names it. */
function pluginClassOf(record: PluginRecord): Function | undefined {
  switch (record.kind) {
    case PluginKind.CLASS_TOKEN:
      return record.provide;
    case PluginKind.CLASS:
      return record.useClass;
    case PluginKind.VALUE:
      return (record.useValue as object | undefined)?.constructor;
    default:
      return undefined;
  }
}

/** The hooks a plugin's class declares, or undefined when its record does not name the class. */
function pluginHooksOf(record: PluginRecord): HookMetadata[] | undefined {
  const pluginClass = pluginClassOf(record);
  if (!pluginClass) return undefined;
  return [...collectHook(pluginClass), ...peekPendingTC39HooksForClass(pluginClass)];
}

/** The keys a plugin list enforces, nested plugins included. */
function keysEnforcedByPlugins(plugins: readonly unknown[] | undefined, into = new Set<string>()): Set<string> {
  for (const plugin of plugins ?? []) {
    const record = tryNormalize(() => normalizePlugin(plugin as Parameters<typeof normalizePlugin>[0]));
    if (!record) continue;
    for (const key of record.metadata.enforcesMetadata ?? []) into.add(key);
    keysEnforcedByPlugins(record.metadata.plugins, into);
  }
  return into;
}

/** The entries the config names, each with the metadata keys the plugins that reach it enforce. */
function collectStaticEntries(config: FrontMcpConfigInput | FrontMcpConfigType): StaticEntry[] {
  const found: Array<{ label: string; metadata: Record<string, unknown>; reach: EntryReach }> = [];
  const everyAppKeys = new Set<string>();
  const ownAppKeys = new Map<object, Set<string>>();

  const add = (label: string, metadata: unknown, reach: EntryReach): boolean => {
    const fields = asMetadata(metadata);
    if (!fields || !isServedEverywhere(fields)) return false;
    found.push({ label, metadata: fields, reach });
    return true;
  };

  const keysOfApp = (app: object): Set<string> => {
    const keys = ownAppKeys.get(app) ?? new Set<string>();
    ownAppKeys.set(app, keys);
    return keys;
  };

  const visitPlugins = (plugins: readonly unknown[] | undefined, app: object | undefined): void => {
    for (const plugin of plugins ?? []) {
      const record = tryNormalize(() => normalizePlugin(plugin as Parameters<typeof normalizePlugin>[0]));
      if (!record) continue;
      const hooks = pluginHooksOf(record);
      if (hooks === undefined || hooks.length > 0) {
        const gatesOnlyItsApp = hooks !== undefined && !hooks.some((hook) => hook.appliesTo === 'uncovered-apps');
        const keys = app && gatesOnlyItsApp ? keysOfApp(app) : everyAppKeys;
        for (const key of record.metadata.enforcesMetadata ?? []) keys.add(key);
      }
      visitEntries(record.metadata as EntryLists, app);
    }
  };

  const visitEntries = (owner: EntryLists, app: object | undefined): void => {
    const reach: EntryReach = app ? { app } : 'every-plugin';
    for (const item of owner.tools ?? []) {
      const record = tryNormalize(() => normalizeTool(item));
      if (record) add(`Tool "${record.metadata.id || record.metadata.name}"`, record.metadata, reach);
    }
    for (const item of owner.resources ?? []) {
      if (tryNormalize(() => isResourceTemplate(item))) {
        const record = tryNormalize(() => normalizeResourceTemplate(item));
        if (record) add(`Resource template "${record.metadata.name}"`, record.metadata, reach);
      } else {
        const record = tryNormalize(() => normalizeResource(item));
        if (record) add(`Resource "${record.metadata.name}"`, record.metadata, reach);
      }
    }
    for (const item of owner.prompts ?? []) {
      const record = tryNormalize(() => normalizePrompt(item));
      if (record) add(`Prompt "${record.metadata.name}"`, record.metadata, reach);
    }
    for (const item of owner.agents ?? []) {
      const record = tryNormalize(() => normalizeAgent(item as Parameters<typeof normalizeAgent>[0]));
      if (!record) continue;
      const agentName = record.metadata.id ?? record.metadata.name;
      if (!add(`Agent "${agentName}"`, record.metadata, reach)) continue;
      // The agent's own tools run in its private scope, which holds only its plugins' hooks.
      const agentKeys =
        record.metadata.execution?.useToolFlow === false
          ? new Set<string>()
          : keysEnforcedByPlugins(record.metadata.plugins);
      for (const toolItem of record.metadata.tools ?? []) {
        const toolRecord = tryNormalize(() => normalizeTool(toolItem));
        if (toolRecord) add(`Tool "${agentName}:${toolRecord.metadata.name}"`, toolRecord.metadata, { agentKeys });
      }
    }
    // `skills:filter` runs every hook for every skill.
    for (const item of owner.skills ?? []) {
      const record = tryNormalize(() => normalizeSkill(item));
      if (record) add(`Skill "${record.metadata.id ?? record.metadata.name}"`, record.metadata, 'every-plugin');
    }
    visitPlugins(owner.plugins, app);
  };

  // The server's own entries: its tools, resources and skills, and its plugins' entries.
  const server = config as EntryLists & { apps?: readonly unknown[] };
  visitEntries(
    { tools: server.tools, resources: server.resources, skills: server.skills, plugins: server.plugins },
    undefined,
  );
  for (const app of server.apps ?? []) {
    const record = tryNormalize(() => normalizeApp(app as Parameters<typeof normalizeApp>[0]));
    if (record?.kind === AppKind.LOCAL_CLASS) visitEntries(record.metadata as EntryLists, record);
  }

  const everyPluginKeys = new Set([...everyAppKeys, ...[...ownAppKeys.values()].flatMap((keys) => [...keys])]);
  const keysReaching = (reach: EntryReach): ReadonlySet<string> => {
    if (reach === 'every-plugin') return everyPluginKeys;
    if ('agentKeys' in reach) return reach.agentKeys;
    return new Set([...everyAppKeys, ...(ownAppKeys.get(reach.app) ?? [])]);
  };
  return found.map(({ label, metadata, reach }) => ({ label, metadata, enforcedBy: keysReaching(reach) }));
}

/**
 * Throw the startup error the full checks throw for what a server config's metadata alone shows:
 * `AuthConfigurationError` for `authorities` without the `authorities` option, then
 * `UnenforcedMetadataError` for a plugin-enforced field no plugin in the config enforces.
 *
 * For entry points that build the server later than they are created (`createFetchHandler` on an
 * edge isolate, `createEdgeMcp`); a server they build still runs the full checks. Reads decorator
 * metadata only, so it is safe at module evaluation on an edge isolate.
 */
export function assertStaticStartupConfig(config: FrontMcpConfigInput | FrontMcpConfigType): void {
  const entries = collectStaticEntries(config);

  if (!(config as { authorities?: unknown }).authorities) {
    const labels = entries
      .filter(({ metadata }) => isEnforcementRequested(metadata['authorities']))
      .map(({ label }) => label);
    if (labels.length > 0) {
      const names = labels.slice(0, 5).join(', ');
      const suffix = labels.length > 5 ? ` and ${labels.length - 5} more` : '';
      throw new AuthConfigurationError(
        `Authorities configuration required: ${names}${suffix} declare 'authorities' metadata ` +
          `but authorities enforcement is not fully configured (engine/context builder missing). ` +
          `Add 'authorities: { claimsMapping: {...}, profiles: {...} }' ` +
          `to your @FrontMcp() decorator to enable enforcement, or remove 'authorities' from entry metadata.`,
        { suggestion: 'Add authorities config to @FrontMcp() or remove authorities from entry metadata' },
      );
    }
  }

  const problems = entries.flatMap(({ label, metadata, enforcedBy }) =>
    getEnforcedMetadataKeys()
      .filter((key) => isEnforcementRequested(metadata[key]) && !enforcedBy.has(key))
      .map((key) => {
        const enforcer = describeMetadataEnforcer(key);
        return `${label} declares '${key}'${enforcer ? ` (enforced by ${enforcer})` : ''}`;
      }),
  );
  if (problems.length > 0) throw new UnenforcedMetadataError(problems);
}
