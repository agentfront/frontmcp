import 'reflect-metadata';
import { Token } from '../interfaces';

export type EntryOwnerKind = 'scope' | 'app' | 'plugin' | 'adapter';
export type EntryOwnerRef = { kind: EntryOwnerKind; id: string, ref: Token };
export type EntryLineage = EntryOwnerRef[]; // root -> leaf; e.g. [{kind:'app', id:'Portal'}, {kind:'plugin', id:'Okta'}]


export abstract class BaseEntry<Record extends { provide: any, metadata: any }, Interface, Metadata> {
  ready: Promise<void>;
  protected readonly record: Record;
  protected readonly token: Token<Interface>;
  readonly metadata: Metadata;

  constructor(record: Record, token?: Token<Interface>, metadata?: Metadata) {
    this.record = record;
    this.token = token ?? record.provide;
    this.metadata = metadata ?? record.metadata;
  }

  protected abstract initialize(): Promise<void>;
}
