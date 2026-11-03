import {
  type AdapterEntry,
  type AdapterRegistryInterface,
  type PluginInstance,
  type PluginRegistryInterface,
  type SkillEntry,
} from '../../common';
import { InternalMcpError } from '../../errors';
import type { SkillRegistryInterface } from '../../skill/skill.registry';

/** The plugins of an app that has none of its own: a remote app's, or a lazy app's until it is loaded. */
export class EmptyPluginRegistry implements PluginRegistryInterface {
  getPlugins(): PluginInstance[] {
    return [];
  }

  getPluginNames(): string[] {
    return [];
  }
}

/** The adapters of an app that has none of its own. */
export class EmptyAdapterRegistry implements AdapterRegistryInterface {
  getAdapters(): AdapterEntry[] {
    return [];
  }
}

/** The skills of an app that has none: a remote app's, or a lazy app's. */
export class EmptySkillRegistry implements SkillRegistryInterface {
  readonly owner = { kind: 'app' as const, id: '_remote', ref: EmptySkillRegistry };
  getSkills(): SkillEntry[] {
    return [];
  }
  getExecutableSkills(): SkillEntry[] {
    return [];
  }
  getKnowledgeOnlySkills(): SkillEntry[] {
    return [];
  }
  findByName(): SkillEntry | undefined {
    return undefined;
  }
  findByQualifiedName(): SkillEntry | undefined {
    return undefined;
  }
  async search(): Promise<[]> {
    return [];
  }
  async loadSkill(): Promise<undefined> {
    return undefined;
  }
  async listSkills() {
    return { skills: [], total: 0, hasMore: false };
  }
  hasAny(): boolean {
    return false;
  }
  async count(): Promise<number> {
    return 0;
  }
  subscribe(): () => void {
    return () => {};
  }
  getCapabilities() {
    return {};
  }
  async validateAllTools() {
    // Empty registry - no skills to validate
    return {
      results: [],
      isValid: true,
      totalSkills: 0,
      failedCount: 0,
      warningCount: 0,
    };
  }
  async syncToExternal() {
    // Empty registry - no skills to sync
    return null;
  }
  setExternalProvider() {
    return undefined;
  }
  getExternalProvider() {
    return undefined;
  }
  hasExternalProvider() {
    return false;
  }
  async registerSkillContent(): Promise<{ id: string; unregister: () => Promise<void> }> {
    throw new InternalMcpError('registerSkillContent is not supported on remote apps', 'UNSUPPORTED_OPERATION');
  }
  async unregisterSkill(): Promise<boolean> {
    return false;
  }
}
