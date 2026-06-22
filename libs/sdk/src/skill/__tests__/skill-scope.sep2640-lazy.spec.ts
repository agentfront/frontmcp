/**
 * Regression: SEP-2640 `skill://` resources must surface in `resources/list`
 * even when skills are mounted LAZILY (after scope-init) — the case for
 * plugin-skilled-openapi syncing a bundle on a stateless V8 worker, where the
 * skill registry is empty at scope-init and fills on the first request.
 *
 * Two guarantees:
 *  1. The STATIC `skill://index.json` registers regardless of `hasAny()` (the
 *     discovery doc reads the registry at READ time), so a bundle that loads
 *     later is never permanently hidden.
 *  2. A per-skill `skill://<name>/SKILL.md` `resources/list` entry appears as
 *     soon as the skill mounts — driven by the skill-registry change
 *     subscription wired in `registerSkillCapabilities`.
 */
import 'reflect-metadata';

import { App } from '../../common/decorators/app.decorator';
import type { SkillContent } from '../../common/interfaces';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';

@App({ id: 'skill-res-app', name: 'skill-res-app' })
class EmptyApp {}

const lazySkill: SkillContent = {
  id: 'lazy-skill',
  name: 'lazy-skill',
  description: 'A lazily mounted skill',
  instructions: '# Lazy\n\nMounted after scope-init.',
  tools: [],
};

describe('SEP-2640 skill:// resources surface lazily-mounted skills', () => {
  let instance: FrontMcpInstance;
  let scope: Scope;

  beforeAll(async () => {
    instance = await FrontMcpInstance.createForGraph({
      info: { name: 'skill-res-test', version: '1.0.0' },
      apps: [EmptyApp],
      // `enabled: true` marks the skills feature in use, so the SEP-2640
      // resources register even though no skill is present at scope-init.
      skillsConfig: { enabled: true },
    });
    scope = instance.getScopes()[0] as Scope;
  });

  afterAll(async () => {
    // FrontMcpInstance exposes no public disposer; best-effort cleanup.
    await (instance as unknown as { dispose?: () => Promise<void> })?.dispose?.();
  });

  const uris = (): string[] =>
    scope.resources
      .getResources(true)
      .map((r) => r.uri)
      .filter((u): u is string => typeof u === 'string');

  it('registers skill://index.json even with NO skills at scope-init (and no per-skill entry yet)', () => {
    expect(uris()).toContain('skill://index.json');
    expect(uris().some((u) => u.endsWith('/SKILL.md'))).toBe(false);
  });

  it('adds a per-skill skill://<name>/SKILL.md entry when a skill mounts AFTER scope-init', async () => {
    await scope.skills.registerSkillContent(lazySkill);
    expect(uris()).toContain('skill://lazy-skill/SKILL.md');
  });
});
