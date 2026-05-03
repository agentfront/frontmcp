import type PromptRegistry from '../../prompt/prompt.registry';
import type ResourceRegistry from '../../resource/resource.registry';
import type { SkillRegistryInterface } from '../../skill/skill.registry';
import type ToolRegistry from '../../tool/tool.registry';
import {
  type AdapterRegistryInterface,
  type PluginRegistryInterface,
  type ProviderRegistryInterface,
} from '../interfaces';
import { type AppMetadata } from '../metadata';
import { type AppRecord } from '../records';
import { BaseEntry } from './base.entry';

export abstract class AppEntry<Metadata = AppMetadata> extends BaseEntry<AppRecord, unknown, Metadata> {
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

  abstract get tools(): ToolRegistry;

  abstract get resources(): ResourceRegistry;

  abstract get prompts(): PromptRegistry;

  abstract get skills(): SkillRegistryInterface;
}
