import {
  buildChannelInstructions,
  buildSkillsCatalogSummary,
  composeInitializeInstructions,
  type InjectInstructionsPolicy,
} from '../skill-instructions.helper';
import type { SkillRegistryInterface } from '../skill.registry';

interface FakeSkill {
  metadata: {
    name: string;
    description?: string;
    visibility?: 'mcp' | 'http' | 'both';
  };
  isHidden?(): boolean;
}

function makeRegistry(skills: FakeSkill[]): SkillRegistryInterface {
  // Only `getSkills` is exercised by the helper; everything else can throw.
  const registry: Partial<SkillRegistryInterface> = {
    getSkills: ((opts?: unknown) => {
      const o = (opts ?? {}) as { visibility?: string };
      if (!o.visibility || o.visibility === 'all') return skills as never;
      return skills.filter((s) => {
        const v = s.metadata.visibility ?? 'both';
        if (v === 'both') return true;
        return v === o.visibility;
      }) as never;
    }) as SkillRegistryInterface['getSkills'],
  };
  return registry as SkillRegistryInterface;
}

/** Mutable registry used to verify dynamic registration is reflected. */
function makeMutableRegistry(initial: FakeSkill[]): {
  registry: SkillRegistryInterface;
  add(skill: FakeSkill): void;
} {
  const skills = [...initial];
  const registry: Partial<SkillRegistryInterface> = {
    getSkills: ((opts?: unknown) => {
      const o = (opts ?? {}) as { visibility?: string };
      if (!o.visibility || o.visibility === 'all') return skills as never;
      return skills.filter((s) => {
        const v = s.metadata.visibility ?? 'both';
        if (v === 'both') return true;
        return v === o.visibility;
      }) as never;
    }) as SkillRegistryInterface['getSkills'],
  };
  return {
    registry: registry as SkillRegistryInterface,
    add(skill) {
      skills.push(skill);
    },
  };
}

describe('skill-instructions.helper', () => {
  describe('buildSkillsCatalogSummary', () => {
    it('returns empty string when registry is missing', () => {
      expect(buildSkillsCatalogSummary(undefined)).toBe('');
    });

    it('returns empty string when no MCP-visible skills exist', () => {
      const registry = makeRegistry([]);
      expect(buildSkillsCatalogSummary(registry)).toBe('');
    });

    it('emits a bounded catalog with name + description', () => {
      const registry = makeRegistry([
        { metadata: { name: 'review_pr', description: 'Review a pull request' } },
        { metadata: { name: 'deploy', description: 'Deploy to production' } },
      ]);

      const summary = buildSkillsCatalogSummary(registry);
      expect(summary).toContain('Available skills');
      // Catalog now points at the actual MCP-visible discovery surface
      // (resource + resource template), not the SDK direct-client method.
      expect(summary).toContain('skills://catalog');
      expect(summary).toContain('skills://{name}/SKILL.md');
      // Must NOT mislead the LLM about a non-existent MCP tool.
      expect(summary).not.toContain('searchSkills');
      expect(summary).toContain('- **review_pr**: Review a pull request');
      expect(summary).toContain('- **deploy**: Deploy to production');
    });

    it('omits the description segment when description is missing', () => {
      const registry = makeRegistry([{ metadata: { name: 'lonely_skill' } }]);
      const summary = buildSkillsCatalogSummary(registry);
      expect(summary).toContain('- **lonely_skill**');
      expect(summary).not.toContain('- **lonely_skill**:');
    });

    it('truncates and notes "showing N of M" when the catalog exceeds the size cap', () => {
      const longDesc = 'x'.repeat(200);
      const skills = Array.from({ length: 200 }, (_, i) => ({
        metadata: { name: `skill_${i}`, description: longDesc },
      }));
      const registry = makeRegistry(skills);
      const summary = buildSkillsCatalogSummary(registry);
      // Footer reports both shown and total counts (issue 6).
      expect(summary).toMatch(/catalog truncated — showing \d+ of 200 skills/);
      // Hard cap NOT exceeded by the footer (issue 5).
      expect(summary.length).toBeLessThanOrEqual(16_000);
    });

    it('respects the cap precisely — final string never exceeds 16K', () => {
      // Stress: descriptions sized so the loop bumps right against the cap.
      const skills = Array.from({ length: 500 }, (_, i) => ({
        metadata: { name: `skill_${i}`, description: 'x'.repeat(50) },
      }));
      const registry = makeRegistry(skills);
      const summary = buildSkillsCatalogSummary(registry);
      expect(summary.length).toBeLessThanOrEqual(16_000);
    });

    it('respects MCP visibility filter (skips http-only skills)', () => {
      const registry = makeRegistry([
        { metadata: { name: 'mcp_only', description: 'visible', visibility: 'mcp' } },
        { metadata: { name: 'http_only', description: 'hidden from mcp', visibility: 'http' } },
        { metadata: { name: 'both_visible', description: 'shows up', visibility: 'both' } },
      ]);
      const summary = buildSkillsCatalogSummary(registry);
      expect(summary).toContain('mcp_only');
      expect(summary).toContain('both_visible');
      expect(summary).not.toContain('http_only');
    });

    describe('markdown sanitization (issue 6)', () => {
      it('strips standalone `---` lines from descriptions', () => {
        const registry = makeRegistry([{ metadata: { name: 'frontmatter_skill', description: 'before\n---\nafter' } }]);
        const summary = buildSkillsCatalogSummary(registry);
        // The standalone --- becomes whitespace (collapsed). The bullet line
        // must NOT contain a standalone --- that would render as a horizontal
        // rule (a single hyphen run between text is fine).
        const bullet = summary.split('\n').find((l) => l.startsWith('- **frontmatter_skill**'));
        expect(bullet).toBeDefined();
        expect(bullet).not.toMatch(/^\s*-{3,}\s*$/m);
      });

      it('escapes backticks so descriptions cannot break out of code spans', () => {
        const registry = makeRegistry([{ metadata: { name: 'codey', description: 'use `rm -rf /` carefully' } }]);
        const summary = buildSkillsCatalogSummary(registry);
        expect(summary).toContain('\\`rm -rf /\\`');
      });

      it('escapes `*` so embedded **bold** does not reflow the bullet', () => {
        const registry = makeRegistry([{ metadata: { name: 'shouty', description: 'this is **very** important' } }]);
        const summary = buildSkillsCatalogSummary(registry);
        expect(summary).toContain('\\*\\*very\\*\\*');
      });

      it('escapes `_` and `[` so emphasis and links stay inert', () => {
        const registry = makeRegistry([{ metadata: { name: 'tricky', description: '_em_ and [link](https://x)' } }]);
        const summary = buildSkillsCatalogSummary(registry);
        expect(summary).toContain('\\_em\\_');
        expect(summary).toContain('\\[link');
      });

      it('collapses multi-line descriptions to a single line', () => {
        const registry = makeRegistry([
          { metadata: { name: 'wrappy', description: 'line one\nline two\n\nline three' } },
        ]);
        const summary = buildSkillsCatalogSummary(registry);
        const bullet = summary.split('\n').find((l) => l.startsWith('- **wrappy**'));
        expect(bullet).toBe('- **wrappy**: line one line two line three');
      });
    });
  });

  describe('composeInitializeInstructions', () => {
    const registry = makeRegistry([{ metadata: { name: 'demo', description: 'A demo skill' } }]);

    it("'replace' policy returns only the user instructions", () => {
      const out = composeInitializeInstructions({
        userInstructions: 'My server prompt.',
        channelInstructions: 'channel-hint',
        skillRegistry: registry,
        policy: 'replace',
      });
      expect(out).toBe('My server prompt.');
    });

    it("'replace' with empty user falls back to 'append' semantics (issue 4)", () => {
      const out = composeInitializeInstructions({
        userInstructions: '',
        channelInstructions: 'Channel hint.',
        skillRegistry: registry,
        policy: 'replace',
      });
      // Channel + catalog must still surface so a misconfigured server
      // doesn't silently drop everything.
      expect(out).toContain('Channel hint.');
      expect(out).toContain('Available skills');
      expect(out).toContain('demo');
    });

    it("'replace' with whitespace-only user falls back to 'append' semantics", () => {
      const out = composeInitializeInstructions({
        userInstructions: '   \n  \t  ',
        channelInstructions: 'Channel hint.',
        skillRegistry: registry,
        policy: 'replace',
      });
      expect(out).toContain('Channel hint.');
      expect(out).toContain('Available skills');
    });

    it("'replace' with undefined user falls back to 'append' semantics", () => {
      const out = composeInitializeInstructions({
        skillRegistry: registry,
        policy: 'replace',
      });
      expect(out).toContain('Available skills');
      expect(out).toContain('demo');
    });

    it("'off' keeps user + channel but drops the skill catalog", () => {
      const out = composeInitializeInstructions({
        userInstructions: 'User text.',
        channelInstructions: 'Channel text.',
        skillRegistry: registry,
        policy: 'off',
      });
      expect(out).toContain('User text.');
      expect(out).toContain('Channel text.');
      expect(out).not.toContain('demo');
    });

    it("'append' (default) joins user, channel, then skill catalog", () => {
      const out = composeInitializeInstructions({
        userInstructions: 'User.',
        channelInstructions: 'Channel.',
        skillRegistry: registry,
      });
      const userIdx = out.indexOf('User.');
      const channelIdx = out.indexOf('Channel.');
      const catalogIdx = out.indexOf('Available skills');
      expect(userIdx).toBeGreaterThanOrEqual(0);
      expect(channelIdx).toBeGreaterThan(userIdx);
      expect(catalogIdx).toBeGreaterThan(channelIdx);
    });

    it("'prepend' puts the skill catalog first", () => {
      const out = composeInitializeInstructions({
        userInstructions: 'User.',
        channelInstructions: 'Channel.',
        skillRegistry: registry,
        policy: 'prepend',
      });
      const userIdx = out.indexOf('User.');
      const catalogIdx = out.indexOf('Available skills');
      expect(catalogIdx).toBeGreaterThanOrEqual(0);
      expect(catalogIdx).toBeLessThan(userIdx);
    });

    it('omits empty sections (no double separators)', () => {
      const out = composeInitializeInstructions({
        userInstructions: '',
        channelInstructions: '',
        skillRegistry: registry,
      });
      expect(out).not.toMatch(/---\n\n---/);
      expect(out).toContain('Available skills');
    });

    it('returns empty string when nothing is configured', () => {
      const out = composeInitializeInstructions({});
      expect(out).toBe('');
    });

    it('reflects skills registered AFTER the first compose call (dynamic registration)', () => {
      const { registry: dyn, add } = makeMutableRegistry([
        { metadata: { name: 'first_skill', description: 'present at boot' } },
      ]);
      const before = composeInitializeInstructions({ skillRegistry: dyn });
      expect(before).toContain('first_skill');
      expect(before).not.toContain('second_skill');

      add({ metadata: { name: 'second_skill', description: 'registered later' } });

      const after = composeInitializeInstructions({ skillRegistry: dyn });
      expect(after).toContain('first_skill');
      expect(after).toContain('second_skill');
    });

    it.each(['off', 'append', 'prepend', 'replace'] satisfies InjectInstructionsPolicy[])(
      "policy '%s' never inserts trailing separator",
      (policy) => {
        const out = composeInitializeInstructions({
          userInstructions: 'U',
          channelInstructions: 'C',
          skillRegistry: registry,
          policy,
        });
        expect(out.endsWith('---')).toBe(false);
      },
    );
  });

  describe('buildChannelInstructions', () => {
    it('returns empty string when channels are absent', () => {
      expect(buildChannelInstructions(undefined)).toBe('');
    });

    it('returns empty string when registry has no channels', () => {
      const channels = {
        hasAny: () => false,
        getChannelInstances: () => [],
      };
      expect(buildChannelInstructions(channels)).toBe('');
    });

    it('mentions the channel-reply tool when at least one channel is two-way', () => {
      const channels = {
        hasAny: () => true,
        getChannelInstances: () => [{ twoWay: true }, { twoWay: false }],
      };
      expect(buildChannelInstructions(channels)).toBe(
        'Events arrive as <channel> tags. Reply with the channel-reply tool.',
      );
    });

    it('omits the reply hint when all channels are one-way', () => {
      const channels = {
        hasAny: () => true,
        getChannelInstances: () => [{ twoWay: false }],
      };
      expect(buildChannelInstructions(channels)).toBe('Events arrive as <channel> tags.');
    });

    it('treats undefined twoWay as one-way', () => {
      const channels = {
        hasAny: () => true,
        getChannelInstances: () => [{}],
      };
      expect(buildChannelInstructions(channels)).toBe('Events arrive as <channel> tags.');
    });
  });
});
