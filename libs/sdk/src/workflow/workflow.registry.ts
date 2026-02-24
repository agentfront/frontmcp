import { Token, tokenName } from '@frontmcp/di';
import { EntryLineage, EntryOwnerRef } from '../common';
import { WorkflowEntry } from '../common/entries/workflow.entry';
import { WorkflowRecord, WorkflowDynamicRecord } from '../common/records/workflow.record';
import { WorkflowType } from '../common/interfaces/workflow.interface';
import { WorkflowChangeEvent, WorkflowEmitter } from './workflow.events';
import ProviderRegistry from '../provider/provider.registry';
import { normalizeWorkflow } from './workflow.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { WorkflowInstance } from './workflow.instance';
import { ownerKeyOf, qualifiedNameOf } from '../utils/lineage.utils';

export interface IndexedWorkflow {
  token: Token;
  instance: WorkflowEntry;
  baseName: string;
  lineage: EntryLineage;
  ownerKey: string;
  qualifiedName: string;
  qualifiedId: string;
  source: WorkflowRegistry;
}

export interface WorkflowRegistryInterface {
  owner: EntryOwnerRef;
  getWorkflows(includeHidden?: boolean): WorkflowEntry[];
  findByName(name: string): WorkflowEntry | undefined;
  findById(id: string): WorkflowEntry | undefined;
  search(query?: string, opts?: { tags?: string[]; labels?: Record<string, string> }): WorkflowEntry[];
  registerDynamic(record: WorkflowDynamicRecord): void;
  removeDynamic(workflowId: string): boolean;
  subscribe(opts: { immediate?: boolean }, cb: (evt: WorkflowChangeEvent) => void): () => void;
  hasAny(): boolean;
}

export default class WorkflowRegistry
  extends RegistryAbstract<WorkflowInstance, WorkflowRecord, WorkflowType[]>
  implements WorkflowRegistryInterface
{
  owner: EntryOwnerRef;

  private localRows: IndexedWorkflow[] = [];
  private dynamicRows: IndexedWorkflow[] = [];
  private byName = new Map<string, IndexedWorkflow>();
  private byId = new Map<string, IndexedWorkflow>();

  private version = 0;
  private emitter = new WorkflowEmitter();

  constructor(providers: ProviderRegistry, list: WorkflowType[], owner: EntryOwnerRef) {
    super('WorkflowRegistry', providers, list, false);
    this.owner = owner;
    this.buildGraph();
    this.ready = this.initialize();
  }

  protected override buildMap(list: WorkflowType[]): RegistryBuildMapResult<WorkflowRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, WorkflowRecord>();
    const graph = new Map<Token, Set<Token>>();
    for (const raw of list) {
      const rec = normalizeWorkflow(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }
    return { tokens, defs, graph };
  }

  protected buildGraph() {
    // Workflows have no compile-time dependency graph
  }

  protected override async initialize(): Promise<void> {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) continue;
      const wi = new WorkflowInstance(rec, this.providers, this.owner);
      this.instances.set(token as Token<WorkflowInstance>, wi);

      const lineage: EntryLineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, wi, lineage);
      this.localRows.push(row);
    }

    this.reindex();
    this.bump('reset');
  }

  // ---- Public API ----

  getWorkflows(includeHidden = false): WorkflowEntry[] {
    const all = [...this.localRows, ...this.dynamicRows].map((r) => r.instance);
    return all.filter((w) => w.metadata.hideFromDiscovery !== true || includeHidden);
  }

  findByName(name: string): WorkflowEntry | undefined {
    return this.byName.get(name)?.instance;
  }

  findById(id: string): WorkflowEntry | undefined {
    return this.byId.get(id)?.instance;
  }

  search(query?: string, opts?: { tags?: string[]; labels?: Record<string, string> }): WorkflowEntry[] {
    let workflows = this.getWorkflows(false);

    if (query) {
      const q = query.toLowerCase();
      workflows = workflows.filter(
        (w) => w.name.toLowerCase().includes(q) || (w.metadata.description ?? '').toLowerCase().includes(q),
      );
    }

    if (opts?.tags && opts.tags.length > 0) {
      workflows = workflows.filter((w) => {
        const tags = w.getTags();
        return opts.tags!.some((t) => tags.includes(t));
      });
    }

    if (opts?.labels) {
      const labelEntries = Object.entries(opts.labels);
      workflows = workflows.filter((w) => {
        const labels = w.getLabels();
        return labelEntries.every(([k, v]) => labels[k] === v);
      });
    }

    return workflows;
  }

  registerDynamic(record: WorkflowDynamicRecord): void {
    const token = Symbol.for(`workflow:dynamic:${record.provide}`) as Token;
    const wi = new WorkflowInstance(record, this.providers, this.owner);
    this.instances.set(token as Token<WorkflowInstance>, wi);

    const lineage: EntryLineage = this.owner ? [this.owner] : [];
    const row = this.makeRow(token, wi, lineage);
    this.dynamicRows.push(row);
    this.reindex();
    this.bump('added');
  }

  removeDynamic(workflowId: string): boolean {
    const idx = this.dynamicRows.findIndex(
      (r) => r.instance.metadata.id === workflowId || r.instance.name === workflowId,
    );
    if (idx === -1) return false;

    const row = this.dynamicRows[idx];
    this.dynamicRows.splice(idx, 1);
    this.instances.delete(row.token as Token<WorkflowInstance>);
    this.reindex();
    this.bump('removed');
    return true;
  }

  subscribe(opts: { immediate?: boolean }, cb: (evt: WorkflowChangeEvent) => void): () => void {
    if (opts.immediate) {
      cb({
        kind: 'reset',
        changeScope: 'global',
        version: this.version,
        snapshot: this.getWorkflows(),
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
        console.warn(
          `WorkflowRegistry: duplicate workflow name "${r.baseName}" detected during reindex; later entry wins`,
        );
      }
      this.byName.set(r.baseName, r);

      const idKey = r.instance.metadata.id ?? r.baseName;
      if (this.byId.has(idKey)) {
        console.warn(`WorkflowRegistry: duplicate workflow id "${idKey}" detected during reindex; later entry wins`);
      }
      this.byId.set(idKey, r);
    }
  }

  private bump(kind: WorkflowChangeEvent['kind']) {
    const version = ++this.version;
    this.emitter.emit({
      kind,
      changeScope: 'global',
      version,
      snapshot: this.getWorkflows(),
    });
  }

  private makeRow(token: Token, instance: WorkflowEntry, lineage: EntryLineage): IndexedWorkflow {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return { token, instance, baseName, lineage, ownerKey, qualifiedName, qualifiedId, source: this };
  }
}
