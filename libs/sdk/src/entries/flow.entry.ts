import 'reflect-metadata';
import { BaseEntry } from './base.entry';
import { FlowRecord } from '../records';
import { FlowBase, FlowInputOf, FlowOutputOf, HttpMethod, ServerRequest, Token, Type } from '../interfaces';
import { FlowMetadata, FlowName } from '../metadata';
import { ScopeEntry } from './scope.entry';
import { z } from 'zod';


export abstract class FlowEntry<Name extends FlowName> extends BaseEntry<FlowRecord, FlowBase, FlowMetadata<never>> {
  readonly name: Name;
  readonly path?: RegExp | string; // string can be "/test/**" or "/test/*/asds", default to all paths;
  readonly method?: HttpMethod;
  readonly scope: ScopeEntry;

  abstract canActivate(request: ServerRequest): Promise<boolean>

  abstract run(input: FlowInputOf<Name>, deps: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined>

  protected constructor(scope: ScopeEntry,record: FlowRecord, token?: Token<FlowBase>, metadata?: FlowMetadata<never>) {
    super(record, token, metadata);
    const { path, method } = record.metadata.middleware ?? metadata?.middleware ?? {};
    this.name = metadata?.name ?? record.metadata?.name;
    this.path = path;
    this.method = method;
    this.scope = scope;
  }

}

