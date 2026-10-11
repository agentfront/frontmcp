import 'reflect-metadata';

import {
  ExternalSkillProviderBase,
  FrontMcp,
  type ScopeEntry,
  type SkillContent,
  type SkillSearchResult,
} from '@frontmcp/sdk';

class CatalogSkillProvider extends ExternalSkillProviderBase {
  protected async fetchSkill(): Promise<SkillContent | null> {
    return null;
  }
  protected async fetchSkills(): Promise<SkillContent[]> {
    return [];
  }
  protected async searchExternal(): Promise<SkillSearchResult[]> {
    return [];
  }
  protected async upsertSkill(): Promise<void> {
    return undefined;
  }
  protected async deleteSkill(): Promise<void> {
    return undefined;
  }
  protected async countExternal(): Promise<number> {
    return 0;
  }
  protected async existsExternal(): Promise<boolean> {
    return false;
  }
}

// `this.scope.skills` declares the setter, so no `instanceof SkillRegistry` narrowing is needed.
export function useCatalog(scope: ScopeEntry): void {
  scope.skills.setExternalProvider(new CatalogSkillProvider({ mode: 'read-only' }));
}

@FrontMcp({
  info: { name: 'dts-skills', version: '1.0.0' },
  apps: [],
  serve: false,
  skillsConfig: { externalProvider: new CatalogSkillProvider({ mode: 'read-only' }) },
})
export class SkillsServer {}
