import 'reflect-metadata';

import { type Token, type Type } from '@frontmcp/di';

import { type FlowBase, type FlowInputOf, type FlowOutputOf, type HttpMethod, type ServerRequest } from '../interfaces';
import { type FlowMetadata, type FlowName } from '../metadata';
import { type FlowRecord } from '../records';
import { BaseEntry } from './base.entry';
import { type ScopeEntry } from './scope.entry';

export abstract class FlowEntry<Name extends FlowName> extends BaseEntry<FlowRecord, FlowBase, FlowMetadata<never>> {
  readonly name: Name;
  readonly path?: RegExp | string; // string can be "/test/**" or "/test/*/asds", default to all paths;
  readonly method?: HttpMethod;
  readonly scope: ScopeEntry;

  abstract canActivate(request: ServerRequest): Promise<boolean>;

  abstract run(input: FlowInputOf<Name>, deps: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined>;

  protected constructor(
    scope: ScopeEntry,
    record: FlowRecord,
    token?: Token<FlowBase>,
    metadata?: FlowMetadata<never>,
  ) {
    super(record, token, metadata);
    const { path, method } = record.metadata.middleware ?? metadata?.middleware ?? {};
    this.name = metadata?.name ?? record.metadata?.name;
    this.path = path;
    this.method = method;
    this.scope = scope;
  }
}
