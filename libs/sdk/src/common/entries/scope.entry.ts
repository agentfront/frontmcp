import { BaseEntry } from './base.entry';
import { ScopeRecord } from '../records';
import {
  ScopeInterface,
  ProviderRegistryInterface,
  AppRegistryInterface,
  AuthRegistryInterface,
  FrontMcpAuth,
  Token,
  FlowInputOf,
  FlowOutputOf,
  Type,
  FlowType,
  FrontMcpLogger,
  ToolRegistryInterface,
  HookRegistryInterface,
  ResourceRegistryInterface,
  PromptRegistryInterface,
} from '../interfaces';
import { FlowName, ScopeMetadata } from '../metadata';
import { normalizeEntryPrefix, normalizeScopeBase } from '../../auth/path.utils';

export abstract class ScopeEntry extends BaseEntry<ScopeRecord, ScopeInterface, ScopeMetadata> {
  abstract readonly id: string;
  abstract readonly entryPath: string;
  abstract readonly routeBase: string;
  abstract readonly logger: FrontMcpLogger;

  get fullPath(): string {
    const prefix = normalizeEntryPrefix(this.entryPath ?? '');
    const scope = normalizeScopeBase(this.routeBase ?? '');
    return `${prefix}${scope}`;
  }

  abstract get auth(): FrontMcpAuth;

  abstract get hooks(): HookRegistryInterface;

  abstract get authProviders(): AuthRegistryInterface;

  abstract get providers(): ProviderRegistryInterface;

  abstract get apps(): AppRegistryInterface;

  abstract get tools(): ToolRegistryInterface;

  abstract get resources(): ResourceRegistryInterface;

  abstract get prompts(): PromptRegistryInterface;

  abstract registryFlows(...flows: FlowType[]): Promise<void>;

  abstract runFlow<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    additionalDeps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined>;
}
