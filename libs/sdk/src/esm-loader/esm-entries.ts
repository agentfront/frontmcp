import { sha256Hex } from '@frontmcp/utils';

import {
  isDecoratedPromptClass,
  isDecoratedResourceClass,
  isDecoratedToolClass,
  normalizePromptFromEsmExport,
  normalizeResourceFromEsmExport,
  normalizeToolFromEsmExport,
} from '../app/instances/esm-normalize.utils';
import {
  type EsmOptions,
  type FrontMcpLogger,
  type PackageLoader,
  type PromptEsmRecord,
  type PromptEsmTargetRecord,
  type PromptRecord,
  type ResourceEsmRecord,
  type ResourceEsmTargetRecord,
  type ResourceRecord,
  type ScopeEntry,
  type SkillMetadata,
  type SkillRecord,
  type ToolEsmRecord,
  type ToolEsmTargetRecord,
  type ToolRecord,
} from '../common';
import { frontMcpSkill } from '../common/decorators/skill.decorator';
import { pickExternalEntry } from '../common/utils/external-entry.utils';
import { ExternalEntryLoadError, type ExternalEntryKind } from '../errors/external-entry.errors';
import { normalizePrompt } from '../prompt/prompt.utils';
import { normalizeResource } from '../resource/resource.utils';
import { isSkillRecord, normalizeSkill } from '../skill/skill.utils';
import { normalizeTool } from '../tool/tool.utils';
import { type EsmRegistryAuth } from './esm-auth.types';
import { EsmCacheManager } from './esm-cache';
import { type FrontMcpPackageManifest } from './esm-manifest';
import { EsmModuleLoader, type EsmLoadResult } from './esm-module-loader';
import { buildEsmPromptRecord, buildEsmResourceRecord, buildEsmToolRecord } from './factories/esm-record-builders';
import { type ParsedPackageSpecifier } from './package-specifier';

/** The registry auth a `PackageLoader` resolves package versions with. */
export function registryAuthOf(loader?: PackageLoader): EsmRegistryAuth | undefined {
  return loader
    ? { registryUrl: loader.registryUrl ?? loader.url, token: loader.token, tokenEnvVar: loader.tokenEnvVar }
    : undefined;
}

/**
 * The loader an entry uses: the server's, with the fields the entry's own loader sets in place of the server's.
 * A token is taken as a whole: an entry that sets `token` or `tokenEnvVar` gets neither of the server's.
 */
export function mergePackageLoaders(
  serverLoader?: PackageLoader,
  entryLoader?: PackageLoader,
): PackageLoader | undefined {
  if (!serverLoader || !entryLoader) return entryLoader ?? serverLoader;
  const entrySetsToken = entryLoader.token !== undefined || entryLoader.tokenEnvVar !== undefined;
  const tokenSource = entrySetsToken ? entryLoader : serverLoader;
  return { ...serverLoader, ...entryLoader, token: tokenSource.token, tokenEnvVar: tokenSource.tokenEnvVar };
}

/**
 * A module loader for packages fetched through `loader` (the registry and bundle CDN), cached for `cacheTTL` ms,
 * with the imports `importMap` names rewritten.
 */
export function createPackageModuleLoader(options: {
  loader?: PackageLoader;
  cacheTTL?: number;
  importMap?: Record<string, string>;
  logger?: FrontMcpLogger;
}): EsmModuleLoader {
  return new EsmModuleLoader({
    cache: new EsmCacheManager({ maxAgeMs: options.cacheTTL }),
    registryAuth: registryAuthOf(options.loader),
    logger: options.logger,
    esmBaseUrl: options.loader?.url,
    importMap: options.importMap,
  });
}

/** The record of a manifest's tool export, its name prefixed by `namespace` when given. */
export function esmToolRecord(raw: unknown, namespace?: string): ToolRecord | undefined {
  if (isDecoratedToolClass(raw)) {
    const record = normalizeTool(raw);
    const name = namespace ? `${namespace}:${record.metadata.name}` : record.metadata.name;
    record.metadata.name = name;
    record.metadata.id = name;
    return record;
  }
  const definition = normalizeToolFromEsmExport(raw);
  return definition && buildEsmToolRecord(definition, namespace);
}

/** The record of a manifest's resource export, its name prefixed by `namespace` when given. */
export function esmResourceRecord(raw: unknown, namespace?: string): ResourceRecord | undefined {
  if (isDecoratedResourceClass(raw)) {
    const record = normalizeResource(raw);
    if (namespace) record.metadata.name = `${namespace}:${record.metadata.name}`;
    return record;
  }
  const definition = normalizeResourceFromEsmExport(raw);
  return definition && buildEsmResourceRecord(definition, namespace);
}

/** The record of a manifest's prompt export, its name prefixed by `namespace` when given. */
export function esmPromptRecord(raw: unknown, namespace?: string): PromptRecord | undefined {
  if (isDecoratedPromptClass(raw)) {
    const record = normalizePrompt(raw);
    if (namespace) record.metadata.name = `${namespace}:${record.metadata.name}`;
    return record;
  }
  const definition = normalizePromptFromEsmExport(raw);
  return definition && buildEsmPromptRecord(definition, namespace);
}

/**
 * The record of a manifest's skill export: a `@Skill` class, a `skill()` result, or a plain
 * `{ name, description, instructions }` object, checked as `skill()` checks it. Anything else is not a skill, and throws.
 */
export function esmSkillRecord(raw: unknown): SkillRecord {
  if (raw !== null && typeof raw === 'object' && !isSkillRecord(raw)) return frontMcpSkill(raw as SkillMetadata);
  return normalizeSkill(raw);
}

/** The records of a manifest's exports of one kind; exports that are not entries of that kind are skipped. */
export function esmManifestRecords<R>(exported: unknown[] | undefined, recordOf: (raw: unknown) => R | undefined): R[] {
  return (exported ?? []).map((raw) => recordOf(raw)).filter((record): record is R => record !== undefined);
}

const packageLoadsByScope = new WeakMap<object, Map<string, Promise<EsmLoadResult>>>();

/** Loads a package once per scope, however many `.esm()` entries name it with the same loader and cache TTL. */
function loadPackageOnce(
  scope: ScopeEntry,
  specifier: ParsedPackageSpecifier,
  options: EsmOptions<object> | undefined,
): Promise<EsmLoadResult> {
  let loads = packageLoadsByScope.get(scope);
  if (!loads) {
    loads = new Map();
    packageLoadsByScope.set(scope, loads);
  }
  const packageLoader = mergePackageLoaders(scope.metadata.loader, options?.loader);
  const loaderFingerprint = sha256Hex(JSON.stringify({ packageLoader, cacheTTL: options?.cacheTTL })).slice(0, 16);
  const key = `${specifier.fullName}@${specifier.range}#${loaderFingerprint}`;
  let load = loads.get(key);
  if (!load) {
    const loader = createPackageModuleLoader({
      loader: packageLoader,
      cacheTTL: options?.cacheTTL,
      logger: scope.logger,
    });
    load = loader.load(specifier);
    loads.set(key, load);
  }
  return load;
}

type EsmEntrySource = { specifier: ParsedPackageSpecifier; targetName?: string; options?: EsmOptions<object> };

/** The named entry of a package with its metadata overrides, or every entry of the kind for a specifier string. */
async function loadEsmEntries<R extends { metadata: { name: string } }>(
  scope: ScopeEntry,
  entryKind: ExternalEntryKind,
  source: EsmEntrySource,
  recordsOf: (manifest: FrontMcpPackageManifest) => R[],
): Promise<R[]> {
  const { manifest } = await loadPackageOnce(scope, source.specifier, source.options).catch((error: unknown) => {
    throw new ExternalEntryLoadError(entryKind, source.targetName, source.specifier.raw, error);
  });
  const records = recordsOf(manifest);
  const { targetName } = source;
  if (targetName === undefined) return records;
  const candidates = records.map((record) => ({ name: record.metadata.name, toRecord: () => record }));
  return [pickExternalEntry(entryKind, { ...source, targetName }, candidates, source.options?.metadata)];
}

/** The tools a `Tool.esm()` entry or a package specifier string in `tools` names. */
export function loadEsmToolEntries(
  scope: ScopeEntry,
  record: ToolEsmRecord | ToolEsmTargetRecord,
): Promise<ToolRecord[]> {
  return loadEsmEntries(scope, 'tool', record, (manifest) => esmManifestRecords(manifest.tools, esmToolRecord));
}

/** The resource a `Resource.esm()` entry names. */
export function loadEsmResourceEntries(
  scope: ScopeEntry,
  record: ResourceEsmRecord | ResourceEsmTargetRecord,
): Promise<ResourceRecord[]> {
  return loadEsmEntries(scope, 'resource', record, (manifest) =>
    esmManifestRecords(manifest.resources, esmResourceRecord),
  );
}

/** The prompt a `Prompt.esm()` entry names. */
export function loadEsmPromptEntries(
  scope: ScopeEntry,
  record: PromptEsmRecord | PromptEsmTargetRecord,
): Promise<PromptRecord[]> {
  return loadEsmEntries(scope, 'prompt', record, (manifest) => esmManifestRecords(manifest.prompts, esmPromptRecord));
}
