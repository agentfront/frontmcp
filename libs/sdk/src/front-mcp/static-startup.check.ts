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
 *   anywhere in the config (on the server, an app, an agent, or inside another plugin) enforces it.
 *
 * Entries the config names are read from their decorators. An entry whose `availableWhen` depends on
 * the process (os, runtime, env, ...) is left to the full checks, as are entries only the built server
 * knows (from adapters, remote or ESM apps, or plugin code).
 */

import { normalizeAgent } from '../agent/agent.utils';
import { normalizeApp } from '../app/app.utils';
import { AppKind, type FrontMcpConfigInput, type FrontMcpConfigType } from '../common';
import {
  describeMetadataEnforcer,
  getEnforcedMetadataKeys,
  isEnforcementRequested,
} from '../common/utils/enforced-metadata.utils';
import { AuthConfigurationError, UnenforcedMetadataError } from '../errors';
import { normalizePlugin } from '../plugin/plugin.utils';
import { normalizePrompt } from '../prompt/prompt.utils';
import { isResourceTemplate, normalizeResource, normalizeResourceTemplate } from '../resource/resource.utils';
import { normalizeSkill } from '../skill/skill.utils';
import { normalizeTool } from '../tool/tool.utils';

/** An entry the config names, labelled as the full checks label it. */
interface StaticEntry {
  label: string;
  metadata: Record<string, unknown>;
}

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

/** The entries the config names, and every metadata key a plugin in it enforces. */
function collectStaticEntries(config: FrontMcpConfigInput | FrontMcpConfigType): {
  entries: StaticEntry[];
  enforcedKeys: Set<string>;
} {
  const entries: StaticEntry[] = [];
  const enforcedKeys = new Set<string>();

  const add = (label: string, metadata: unknown): boolean => {
    const fields = asMetadata(metadata);
    if (!fields || !isServedEverywhere(fields)) return false;
    entries.push({ label, metadata: fields });
    return true;
  };

  const visitPlugins = (plugins: readonly unknown[] | undefined, withEntries: boolean): void => {
    for (const plugin of plugins ?? []) {
      const record = tryNormalize(() => normalizePlugin(plugin as Parameters<typeof normalizePlugin>[0]));
      if (!record) continue;
      for (const key of record.metadata.enforcesMetadata ?? []) enforcedKeys.add(key);
      // An agent's plugins serve only that agent, whose own tools the full checks judge by those plugins alone.
      if (withEntries) visitEntries(record.metadata as EntryLists);
      else visitPlugins(record.metadata.plugins, false);
    }
  };

  const visitEntries = (owner: EntryLists): void => {
    for (const item of owner.tools ?? []) {
      const record = tryNormalize(() => normalizeTool(item));
      if (record) add(`Tool "${record.metadata.id || record.metadata.name}"`, record.metadata);
    }
    for (const item of owner.resources ?? []) {
      if (tryNormalize(() => isResourceTemplate(item))) {
        const record = tryNormalize(() => normalizeResourceTemplate(item));
        if (record) add(`Resource template "${record.metadata.name}"`, record.metadata);
      } else {
        const record = tryNormalize(() => normalizeResource(item));
        if (record) add(`Resource "${record.metadata.name}"`, record.metadata);
      }
    }
    for (const item of owner.prompts ?? []) {
      const record = tryNormalize(() => normalizePrompt(item));
      if (record) add(`Prompt "${record.metadata.name}"`, record.metadata);
    }
    for (const item of owner.agents ?? []) {
      const record = tryNormalize(() => normalizeAgent(item as Parameters<typeof normalizeAgent>[0]));
      if (!record) continue;
      const agentName = record.metadata.id ?? record.metadata.name;
      if (!add(`Agent "${agentName}"`, record.metadata)) continue;
      for (const toolItem of record.metadata.tools ?? []) {
        const toolRecord = tryNormalize(() => normalizeTool(toolItem));
        if (toolRecord) add(`Tool "${agentName}:${toolRecord.metadata.name}"`, toolRecord.metadata);
      }
      visitPlugins(record.metadata.plugins, false);
    }
    for (const item of owner.skills ?? []) {
      const record = tryNormalize(() => normalizeSkill(item));
      if (record) add(`Skill "${record.metadata.id ?? record.metadata.name}"`, record.metadata);
    }
    visitPlugins(owner.plugins, true);
  };

  // The server's own entries: its skills and its plugins' entries (its `tools` and `resources` lists
  // are not registered by any scope, so the full checks never see them either).
  const server = config as EntryLists & { apps?: readonly unknown[] };
  visitEntries({ skills: server.skills, plugins: server.plugins });
  for (const app of server.apps ?? []) {
    const record = tryNormalize(() => normalizeApp(app as Parameters<typeof normalizeApp>[0]));
    if (record?.kind === AppKind.LOCAL_CLASS) visitEntries(record.metadata as EntryLists);
  }
  return { entries, enforcedKeys };
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
  const { entries, enforcedKeys } = collectStaticEntries(config);

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

  const unenforced = getEnforcedMetadataKeys().filter((key) => !enforcedKeys.has(key));
  const problems = entries.flatMap(({ label, metadata }) =>
    unenforced
      .filter((key) => isEnforcementRequested(metadata[key]))
      .map((key) => {
        const enforcer = describeMetadataEnforcer(key);
        return `${label} declares '${key}'${enforcer ? ` (enforced by ${enforcer})` : ''}`;
      }),
  );
  if (problems.length > 0) throw new UnenforcedMetadataError(problems);
}
