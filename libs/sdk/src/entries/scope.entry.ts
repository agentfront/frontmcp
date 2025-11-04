import type { RouterType } from 'itty-router';
import { BaseEntry } from './base.entry';
import { ScopeRecord } from '../records';
import {
  ScopeInterface,
  ProviderRegistryInterface,
  AppRegistryInterface,
  AuthRegistryInterface,
  FrontMcpAuth,
  Token, FlowInputOf, FlowOutputOf, Type, FlowType, FrontMcpLogger,
} from '../interfaces';
import { FlowName, ScopeMetadata } from '../metadata';

export abstract class ScopeEntry extends BaseEntry<ScopeRecord, ScopeInterface, ScopeMetadata> {
  abstract readonly id: string;
  abstract readonly entryPath: string;
  abstract readonly routeBase: string;
  abstract readonly logger: FrontMcpLogger;

  abstract get auth(): FrontMcpAuth;

  abstract get authProviders(): AuthRegistryInterface;

  abstract get providers(): ProviderRegistryInterface;

  abstract get apps(): AppRegistryInterface;

  abstract registryFlows(...flows: FlowType[]): Promise<void>;

  abstract runFlow<Name extends FlowName>(name: Name, input: FlowInputOf<Name>, additionalDeps?: Map<Token, Type>): Promise<FlowOutputOf<Name> | undefined>;
}
