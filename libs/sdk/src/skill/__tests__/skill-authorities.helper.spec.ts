/**
 * Skill Authorities Enforcement Tests
 *
 * Verifies `@Skill({ authorities })` enforcement mirrors the tool/resource
 * pattern:
 *   - assertSkillAuthorized denies an unauthorized caller (AuthorityDeniedError,
 *     MCP code -32003) and allows an authorized one.
 *   - filterSkillsByAuthorities hides skills the caller can't discover.
 *   - Skills WITHOUT `authorities` are never gated.
 *   - When no authorities engine is configured everything is a no-op (defaults
 *     preserved).
 */

import 'reflect-metadata';

import {
  AuthoritiesContextBuilder,
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
  AuthorityDeniedError,
} from '@frontmcp/auth';

import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { Skill, SkillContext, type SkillContent } from '../../common';
import { assertSkillAuthorized, filterSkillsByAuthorities, getSkillAuthorities } from '../skill-authorities.helper';
import SkillRegistry from '../skill.registry';

class MockSkillContext extends SkillContext {
  async loadInstructions(): Promise<string> {
    return this.metadata.instructions as string;
  }

  async build(): Promise<SkillContent> {
    return {
      id: this.skillId,
      name: this.skillName,
      description: this.metadata.description,
      instructions: await this.loadInstructions(),
      tools: this.getToolRefs().map((t) => ({ name: t.name, purpose: t.purpose })),
    };
  }
}

/** Build a real authorities engine + context builder with an `admin` profile. */
function buildAuthoritiesScope() {
  const profiles = new AuthoritiesProfileRegistry();
  profiles.registerAll({ admin: { roles: { any: ['admin', 'superadmin'] } } });
  const evaluators = new AuthoritiesEvaluatorRegistry();
  const engine = new AuthoritiesEngine(profiles, evaluators);
  const ctxBuilder = new AuthoritiesContextBuilder({
    claimsMapping: { roles: 'roles', permissions: 'permissions' },
  });
  return {
    authoritiesEngine: engine,
    authoritiesContextBuilder: ctxBuilder,
    authoritiesScopeMapping: undefined,
  };
}

const NO_ENGINE_SCOPE = {
  authoritiesEngine: undefined,
  authoritiesContextBuilder: undefined,
  authoritiesScopeMapping: undefined,
};

async function buildRegistry() {
  @Skill({
    name: 'admin-skill',
    description: 'Restricted to admins',
    instructions: 'Admin-only workflow',
    authorities: { roles: { any: ['admin'] } },
  })
  class AdminSkill extends MockSkillContext {}

  @Skill({
    name: 'public-skill',
    description: 'No authorities — open to all',
    instructions: 'Public workflow',
  })
  class PublicSkill extends MockSkillContext {}

  const providers = await createProviderRegistryWithScope();
  const owner = { kind: 'app' as const, id: 'test-app', ref: Symbol('test') };
  const registry = new SkillRegistry(providers, [AdminSkill, PublicSkill], owner);
  await registry.ready;
  return registry;
}

const ADMIN_AUTH = { user: { sub: 'admin-user', roles: ['admin'] } };
const VIEWER_AUTH = { user: { sub: 'viewer', roles: ['viewer'] } };

describe('skill authorities enforcement', () => {
  describe('getSkillAuthorities', () => {
    it('returns the authorities metadata for a gated skill', async () => {
      const registry = await buildRegistry();
      const adminSkill = registry.findByName('admin-skill')!;
      expect(getSkillAuthorities(adminSkill)).toEqual({ roles: { any: ['admin'] } });
    });

    it('returns undefined for a skill without authorities', async () => {
      const registry = await buildRegistry();
      const publicSkill = registry.findByName('public-skill')!;
      expect(getSkillAuthorities(publicSkill)).toBeUndefined();
    });
  });

  describe('assertSkillAuthorized — direct load/read deny', () => {
    it('allows an authorized caller to load a gated skill', async () => {
      const registry = await buildRegistry();
      const scope = buildAuthoritiesScope();
      const adminSkill = registry.findByName('admin-skill')!;
      await expect(assertSkillAuthorized(scope, adminSkill, ADMIN_AUTH)).resolves.toBeUndefined();
    });

    it('denies an unauthorized caller with AuthorityDeniedError (-32003)', async () => {
      const registry = await buildRegistry();
      const scope = buildAuthoritiesScope();
      const adminSkill = registry.findByName('admin-skill')!;

      await expect(assertSkillAuthorized(scope, adminSkill, VIEWER_AUTH)).rejects.toBeInstanceOf(AuthorityDeniedError);

      try {
        await assertSkillAuthorized(scope, adminSkill, VIEWER_AUTH);
        throw new Error('expected denial');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthorityDeniedError);
        const denied = err as AuthorityDeniedError;
        expect(denied.mcpErrorCode).toBe(-32003);
        expect(denied.entryType).toBe('Skill');
        expect(denied.toJsonRpcError().code).toBe(-32003);
      }
    });

    it('is a no-op for a skill without authorities', async () => {
      const registry = await buildRegistry();
      const scope = buildAuthoritiesScope();
      const publicSkill = registry.findByName('public-skill')!;
      await expect(assertSkillAuthorized(scope, publicSkill, VIEWER_AUTH)).resolves.toBeUndefined();
    });

    it('is a no-op when no authorities engine is configured (default preserved)', async () => {
      const registry = await buildRegistry();
      const adminSkill = registry.findByName('admin-skill')!;
      // Even an unauthorized caller is allowed through when enforcement is off.
      await expect(assertSkillAuthorized(NO_ENGINE_SCOPE, adminSkill, VIEWER_AUTH)).resolves.toBeUndefined();
    });
  });

  describe('filterSkillsByAuthorities — discovery filtering', () => {
    it('hides gated skills from an unauthorized caller, keeps public ones', async () => {
      const registry = await buildRegistry();
      const scope = buildAuthoritiesScope();
      const all = registry.getSkills(true);

      const visible = await filterSkillsByAuthorities(scope, all, VIEWER_AUTH);
      const names = visible.map((s) => s.name);
      expect(names).toContain('public-skill');
      expect(names).not.toContain('admin-skill');
    });

    it('shows gated skills to an authorized caller', async () => {
      const registry = await buildRegistry();
      const scope = buildAuthoritiesScope();
      const all = registry.getSkills(true);

      const visible = await filterSkillsByAuthorities(scope, all, ADMIN_AUTH);
      const names = visible.map((s) => s.name);
      expect(names).toContain('public-skill');
      expect(names).toContain('admin-skill');
    });

    it('returns all skills unchanged when no engine is configured (default preserved)', async () => {
      const registry = await buildRegistry();
      const all = registry.getSkills(true);

      const visible = await filterSkillsByAuthorities(NO_ENGINE_SCOPE, all, VIEWER_AUTH);
      expect(visible.map((s) => s.name).sort()).toEqual(all.map((s) => s.name).sort());
    });
  });
});
