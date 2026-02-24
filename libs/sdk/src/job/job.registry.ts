import { Token, tokenName } from '@frontmcp/di';
import { EntryLineage, EntryOwnerRef } from '../common';
import { FrontMcpLogger } from '../common/interfaces/logger.interface';
import { JobEntry } from '../common/entries/job.entry';
import { JobRecord, JobDynamicRecord } from '../common/records/job.record';
import { JobType } from '../common/interfaces/job.interface';
import { JobChangeEvent, JobEmitter } from './job.events';
import ProviderRegistry from '../provider/provider.registry';
import { normalizeJob, jobDiscoveryDeps } from './job.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { JobInstance } from './job.instance';
import { ownerKeyOf, qualifiedNameOf } from '../utils/lineage.utils';
import { RegistryDefinitionNotFoundError, RegistryGraphEntryNotFoundError } from '../errors';

export interface IndexedJob {
  token: Token;
  instance: JobEntry;
  baseName: string;
  lineage: EntryLineage;
  ownerKey: string;
  qualifiedName: string;
  qualifiedId: string;
  source: JobRegistry;
}

export interface JobRegistryInterface {
  readonly owner: EntryOwnerRef;
  getJobs(includeHidden?: boolean): JobEntry[];
  findByName(name: string): JobEntry | undefined;
  findById(id: string): JobEntry | undefined;
  search(query?: string, opts?: { tags?: string[]; labels?: Record<string, string> }): JobEntry[];
  hasAny(): boolean;
  registerDynamic(record: JobDynamicRecord): void;
  removeDynamic(jobId: string): boolean;
  subscribe(opts: { immediate?: boolean }, cb: (evt: JobChangeEvent) => void): () => void;
}

export default class JobRegistry
  extends RegistryAbstract<JobInstance, JobRecord, JobType[]>
  implements JobRegistryInterface
{
  readonly owner: EntryOwnerRef;

  private localRows: IndexedJob[] = [];
  private dynamicRows: IndexedJob[] = [];
  private byName = new Map<string, IndexedJob>();
  private byId = new Map<string, IndexedJob>();

  private version = 0;
  private emitter = new JobEmitter();
  private logger?: FrontMcpLogger;

  constructor(providers: ProviderRegistry, list: JobType[], owner: EntryOwnerRef) {
    super('JobRegistry', providers, list, false);
    this.owner = owner;
    try {
      this.logger = providers.get(FrontMcpLogger);
    } catch {
      // Logger not available - optional dependency
    }
    this.buildGraph();
    this.ready = this.initialize();
  }

  protected override buildMap(list: JobType[]): RegistryBuildMapResult<JobRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, JobRecord>();
    const graph = new Map<Token, Set<Token>>();
    for (const raw of list) {
      const rec = normalizeJob(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }
    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new RegistryDefinitionNotFoundError('JobRegistry', tokenName(token));
      }
      const deps = jobDiscoveryDeps(rec);
      for (const d of deps) {
        this.providers.get(d);
        const edges = this.graph.get(token);
        if (!edges) {
          throw new RegistryGraphEntryNotFoundError('JobRegistry', tokenName(token));
        }
        edges.add(d);
      }
    }
  }

  protected override async initialize(): Promise<void> {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new RegistryDefinitionNotFoundError('JobRegistry', tokenName(token));
      }
      const ji = new JobInstance(rec, this.providers, this.owner);
      this.instances.set(token as Token<JobInstance>, ji);

      const lineage: EntryLineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, ji, lineage);
      this.localRows.push(row);
    }

    this.reindex();
    this.bump('reset');
  }

  // ---- Public API ----

  getJobs(includeHidden = false): JobEntry[] {
    const all = [...this.localRows, ...this.dynamicRows].map((r) => r.instance);
    return all.filter((j) => j.metadata.hideFromDiscovery !== true || includeHidden);
  }

  findByName(name: string): JobEntry | undefined {
    return this.byName.get(name)?.instance;
  }

  findById(id: string): JobEntry | undefined {
    return this.byId.get(id)?.instance;
  }

  search(query?: string, opts?: { tags?: string[]; labels?: Record<string, string> }): JobEntry[] {
    let jobs = this.getJobs(false);

    if (query) {
      const q = query.toLowerCase();
      jobs = jobs.filter(
        (j) => j.name.toLowerCase().includes(q) || (j.metadata.description ?? '').toLowerCase().includes(q),
      );
    }

    if (opts?.tags && opts.tags.length > 0) {
      const filterTags = opts.tags;
      jobs = jobs.filter((j) => {
        const tags = j.getTags();
        return filterTags.some((t) => tags.includes(t));
      });
    }

    if (opts?.labels) {
      const labelEntries = Object.entries(opts.labels);
      jobs = jobs.filter((j) => {
        const labels = j.getLabels();
        return labelEntries.every(([k, v]) => labels[k] === v);
      });
    }

    return jobs;
  }

  registerDynamic(record: JobDynamicRecord): void {
    const token = Symbol.for(`job:dynamic:${record.provide}`) as Token;

    const existing = this.dynamicRows.findIndex((r) => r.token === token);
    if (existing !== -1) {
      this.dynamicRows.splice(existing, 1);
    }

    const ji = new JobInstance(record, this.providers, this.owner);
    this.instances.set(token as Token<JobInstance>, ji);

    const lineage: EntryLineage = this.owner ? [this.owner] : [];
    const row = this.makeRow(token, ji, lineage);
    this.dynamicRows.push(row);
    this.reindex();
    this.bump('added');
  }

  removeDynamic(jobId: string): boolean {
    const idx = this.dynamicRows.findIndex((r) => r.instance.metadata.id === jobId || r.instance.name === jobId);
    if (idx === -1) return false;

    const row = this.dynamicRows[idx];
    this.dynamicRows.splice(idx, 1);
    this.instances.delete(row.token as Token<JobInstance>);
    this.reindex();
    this.bump('removed');
    return true;
  }

  subscribe(opts: { immediate?: boolean }, cb: (evt: JobChangeEvent) => void): () => void {
    if (opts.immediate) {
      cb({
        kind: 'reset',
        changeScope: 'global',
        version: this.version,
        snapshot: this.getJobs(),
      });
    }
    return this.emitter.on(cb);
  }

  hasAny(): boolean {
    return this.localRows.length > 0 || this.dynamicRows.length > 0;
  }

  // ---- Private ----

  private reindex() {
    this.byName.clear();
    this.byId.clear();
    const effective = [...this.localRows, ...this.dynamicRows];
    for (const r of effective) {
      if (this.byName.has(r.baseName)) {
        this.logger?.warn(`JobRegistry: duplicate job name "${r.baseName}" detected during reindex; later entry wins`);
      }
      this.byName.set(r.baseName, r);

      const idKey = r.instance.metadata.id ?? r.baseName;
      if (this.byId.has(idKey)) {
        this.logger?.warn(`JobRegistry: duplicate job id "${idKey}" detected during reindex; later entry wins`);
      }
      this.byId.set(idKey, r);
    }
  }

  private bump(kind: JobChangeEvent['kind']) {
    const version = ++this.version;
    this.emitter.emit({
      kind,
      changeScope: 'global',
      version,
      snapshot: this.getJobs(),
    });
  }

  private makeRow(token: Token, instance: JobEntry, lineage: EntryLineage): IndexedJob {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return { token, instance, baseName, lineage, ownerKey, qualifiedName, qualifiedId, source: this };
  }
}
