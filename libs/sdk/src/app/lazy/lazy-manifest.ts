import { dirname, fileExists, pathResolve, readFile } from '@frontmcp/utils';

import type { ScopeEntry } from '../../common/entries/scope.entry';
import type { ListChangedKind } from '../../common/interfaces/flow.interface';
import { LazyAppConfigurationError } from '../../errors/lazy-app.errors';
import {
  SERVER_MANIFEST_FILE,
  serverManifestSchema,
  type ManifestApp,
  type ManifestPrompt,
  type ManifestResource,
  type ManifestResourceTemplate,
  type ManifestSkill,
  type ManifestTool,
  type ServerManifest,
} from '../../manifest/server-manifest.schema';

export interface ManifestLookup {
  manifest?: ServerManifest;
  /** Where the manifest was read from, or looked for. */
  where: string;
}

/** What the manifest lists for one app. */
export interface ListedApp {
  app: ManifestApp;
  tools: ManifestTool[];
  resources: ManifestResource[];
  resourceTemplates: ManifestResourceTemplate[];
  prompts: ManifestPrompt[];
  skills: ManifestSkill[];
}

/** The entries of each list, as the manifest records them. */
export type RecordedLists = Record<ListChangedKind, readonly object[]>;

const lookups = new WeakMap<ScopeEntry, Promise<ManifestLookup>>();
const notedEagerLoading = new WeakSet<ScopeEntry>();

/** The manifest the scope's lazy apps are listed from: `@FrontMcp({ manifest })`, else the one next to the entry script. */
export function serverManifestOf(scope: ScopeEntry): Promise<ManifestLookup> {
  let lookup = lookups.get(scope);
  if (!lookup) {
    const { manifest, __sourceDir } = scope.metadata as { manifest?: string | ServerManifest; __sourceDir?: string };
    lookup = readServerManifest(manifest, __sourceDir);
    lookups.set(scope, lookup);
  }
  return lookup;
}

async function readServerManifest(
  option: string | ServerManifest | undefined,
  sourceDir?: string,
): Promise<ManifestLookup> {
  if (typeof option === 'object')
    return { manifest: parsedManifest(option, '@FrontMcp({ manifest })'), where: '@FrontMcp({ manifest })' };
  const path = option === undefined ? manifestNextToEntry() : pathResolve(sourceDir ?? process.cwd(), option);
  if (!path) return { where: `${SERVER_MANIFEST_FILE} next to the entry script, which this runtime does not name` };
  if (!(await fileExists(path))) return { where: path };
  let content: unknown;
  try {
    content = JSON.parse(await readFile(path));
  } catch (error) {
    throw unreadableManifest(path, error instanceof Error ? error.message : String(error));
  }
  return { manifest: parsedManifest(content, path), where: path };
}

function manifestNextToEntry(): string | undefined {
  const entry = typeof process === 'undefined' ? undefined : process.argv?.[1];
  return entry ? pathResolve(dirname(pathResolve(entry)), SERVER_MANIFEST_FILE) : undefined;
}

function parsedManifest(value: unknown, where: string): ServerManifest {
  const parsed = serverManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`);
  throw unreadableManifest(where, issues.join('; '));
}

function unreadableManifest(where: string, reason: string): LazyAppConfigurationError {
  return new LazyAppConfigurationError(
    `${where} is not a ${SERVER_MANIFEST_FILE} this server can read (${reason}). Run \`frontmcp build\` to write it again.`,
  );
}

/** Log, once per scope, that its lazy apps are imported at startup because no manifest was found. */
export function noteEagerLoading(scope: ScopeEntry, where: string): void {
  if (notedEagerLoading.has(scope)) return;
  notedEagerLoading.add(scope);
  scope.logger.info(
    `No ${SERVER_MANIFEST_FILE} (looked for ${where}): lazy apps are loaded at startup. ` +
      'Run `frontmcp build` to write one; with it, each lazy app is imported on its first call.',
  );
}

/** What the manifest lists for app `appId`, or undefined when it does not list the app. */
export function listedAppOf(manifest: ServerManifest, appId: string): ListedApp | undefined {
  const app = manifest.apps.find((candidate) => candidate.id === appId);
  if (!app) return undefined;
  const own = <Entry extends { app?: string }>(entries: Entry[]) => entries.filter((entry) => entry.app === appId);
  return {
    app,
    tools: own(manifest.tools),
    resources: own(manifest.resources),
    resourceTemplates: own(manifest.resourceTemplates),
    prompts: own(manifest.prompts),
    skills: own(manifest.skills),
  };
}

/** The lists the manifest records for `listed`, keyed like `list_changed`. */
export function recordedListsOf(listed: ListedApp): RecordedLists {
  return {
    tools: listed.tools,
    resources: [...listed.resources, ...listed.resourceTemplates],
    prompts: listed.prompts,
  };
}

/** JSON with every object's keys sorted, so two records compare equal whatever order their fields were written in. */
function canonicalJson(value: unknown): string {
  const sorted = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sorted);
    if (node === null || typeof node !== 'object') return node;
    const record = node as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sorted(record[key])]),
    );
  };
  return JSON.stringify(sorted(JSON.parse(JSON.stringify(value))));
}

function sameEntries(left: readonly object[], right: readonly object[]): boolean {
  const fingerprint = (entries: readonly object[]) => entries.map(canonicalJson).sort().join('\n');
  return fingerprint(left) === fingerprint(right);
}

/** The lists whose entries differ between the manifest and the loaded app; the app's output policy shapes the tools. */
export function changedLists(
  listed: RecordedLists,
  loaded: RecordedLists,
  outputs: { listed?: object; loaded?: object },
): ListChangedKind[] {
  const kinds: ListChangedKind[] = ['tools', 'resources', 'prompts'];
  return kinds.filter(
    (kind) =>
      !sameEntries(listed[kind], loaded[kind]) ||
      (kind === 'tools' && canonicalJson(outputs.listed ?? {}) !== canonicalJson(outputs.loaded ?? {})),
  );
}
