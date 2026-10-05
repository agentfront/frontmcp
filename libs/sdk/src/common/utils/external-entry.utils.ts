import {
  ExternalEntryNotFoundError,
  ExternalEntryNotSupportedError,
  type ExternalEntryKind,
} from '../../errors/external-entry.errors';
import { type ParsedPackageSpecifier } from '../../esm-loader/package-specifier';

/** A `.esm()` / `.remote()` record (`Tool.esm('@acme/tools', 'echo')`), or the record of a package specifier string. */
export type ExternalEntryRecord = { targetName?: string } & ({ url: string } | { specifier: ParsedPackageSpecifier });

/** An entry a package or remote server provides, built into a record only once picked. */
export interface ExternalEntryCandidate<R> {
  name: string;
  toRecord: () => R;
}

/** True for the record a `.esm()` / `.remote()` factory returns. */
export function isExternalEntryRecord(value: unknown): value is ExternalEntryRecord & { targetName: string } {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (entry['kind'] === 'ESM' || entry['kind'] === 'REMOTE') && typeof entry['targetName'] === 'string';
}

/** The package specifier or server URL an external entry comes from. */
export function externalEntrySource(record: ExternalEntryRecord): string {
  return 'url' in record ? record.url : record.specifier.raw;
}

/** The candidate the entry names, with `overrides` laid over its metadata; `ExternalEntryNotFoundError` if none. */
export function pickExternalEntry<R extends { metadata: object }>(
  entryKind: ExternalEntryKind,
  record: ExternalEntryRecord & { targetName: string },
  candidates: readonly ExternalEntryCandidate<R>[],
  overrides: object | undefined,
): R {
  const target = candidates.find((candidate) => candidate.name === record.targetName);
  if (!target) {
    throw new ExternalEntryNotFoundError(
      entryKind,
      record.targetName,
      externalEntrySource(record),
      candidates.map((candidate) => candidate.name),
    );
  }
  const picked = target.toRecord();
  if (!overrides) return picked;
  // A tool is named by its id first, so a new name replaces the id too.
  const renamed = 'name' in overrides && !('id' in overrides) && 'id' in picked.metadata ? { id: overrides.name } : {};
  return Object.assign({}, picked, { metadata: { ...picked.metadata, ...overrides, ...renamed } });
}

const DECLARE_LOCALLY: Record<'agent' | 'skill' | 'job', string> = {
  agent: 'declare the agent with @Agent() or agent()',
  skill: 'declare the skill with @Skill() or skill()',
  job: 'declare the job with @Job() or job()',
};

/** The startup error for `Agent.esm()`, `Skill.esm()`, `Job.esm()` and their `.remote()` siblings. */
export function unsupportedExternalEntry(
  entryKind: 'agent' | 'skill' | 'job',
  record: ExternalEntryRecord,
): ExternalEntryNotSupportedError {
  return new ExternalEntryNotSupportedError(
    entryKind,
    record.targetName,
    externalEntrySource(record),
    `per-entry .esm() and .remote() loading is supported for tools, resources and prompts only; ${DECLARE_LOCALLY[entryKind]} instead`,
  );
}

/** The error for a `.esm()` / `.remote()` entry added to a registry after it started, e.g. by `replaceAll()`. */
export function externalEntryAfterStartup(
  entryKind: 'tool' | 'resource' | 'prompt',
  record: ExternalEntryRecord,
): ExternalEntryNotSupportedError {
  return new ExternalEntryNotSupportedError(
    entryKind,
    record.targetName,
    externalEntrySource(record),
    '.esm() and .remote() entries are loaded when their registry starts, not added to it later',
  );
}
