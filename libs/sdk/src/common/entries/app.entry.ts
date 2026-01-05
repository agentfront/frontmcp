import { BaseEntry } from './base.entry';
import { AppRecord } from '../records';
import {
  AdapterRegistryInterface,
  AppInterface,
  PluginRegistryInterface,
  PromptRegistryInterface,
  ProviderRegistryInterface,
  ResourceRegistryInterface,
  ToolRegistryInterface,
} from '../interfaces';
import { AppMetadata } from '../metadata';

export abstract class AppEntry<Metadata = AppMetadata> extends BaseEntry<AppRecord, AppInterface, Metadata> {
  readonly id: string;

  /**
   * Whether this app instance is a remote MCP app.
   * Used to determine adoption strategy in registries.
   * - Remote apps: entries are adopted directly from the app's registries
   * - Local apps: entries are adopted through child registry hierarchy
   */
  get isRemote(): boolean {
    return false;
  }

  abstract get providers(): ProviderRegistryInterface;

  abstract get adapters(): AdapterRegistryInterface;

  abstract get plugins(): PluginRegistryInterface;

  abstract get tools(): ToolRegistryInterface;

  abstract get resources(): ResourceRegistryInterface;

  abstract get prompts(): PromptRegistryInterface;
}
