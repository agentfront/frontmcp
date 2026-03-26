/**
 * SKILL.md Frontmatter Parser Tests
 */

import { parseSkillMdFrontmatter, skillMdFrontmatterToMetadata, stripFrontmatter } from '../skill-md-parser';

describe('skill-md-parser', () => {
  describe('parseSkillMdFrontmatter', () => {
    it('should parse valid SKILL.md with full frontmatter', () => {
      const content = `---
name: review-pr
description: Review a GitHub pull request
license: MIT
compatibility: Requires git CLI
---
# Instructions

Step 1: Fetch the PR details
Step 2: Review the code`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter).toEqual({
        name: 'review-pr',
        description: 'Review a GitHub pull request',
        license: 'MIT',
        compatibility: 'Requires git CLI',
      });
      expect(result.body).toContain('# Instructions');
      expect(result.body).toContain('Step 1: Fetch the PR details');
    });

    it('should parse minimal frontmatter (name + description only)', () => {
      const content = `---
name: simple-skill
description: A simple skill
---
Do the thing.`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter['name']).toBe('simple-skill');
      expect(result.frontmatter['description']).toBe('A simple skill');
      expect(result.body).toBe('Do the thing.');
    });

    it('should parse content without frontmatter (plain markdown)', () => {
      const content = `# Just a Markdown File

This has no frontmatter.`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should parse frontmatter with metadata and allowed-tools', () => {
      const content = `---
name: deploy-app
description: Deploy an application
metadata:
  author: team-a
  version: "2.0"
allowed-tools: Read Edit Bash(git status)
---
Deploy instructions here.`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter['name']).toBe('deploy-app');
      expect(result.frontmatter['metadata']).toEqual({ author: 'team-a', version: '2.0' });
      expect(result.frontmatter['allowed-tools']).toBe('Read Edit Bash(git status)');
      expect(result.body).toBe('Deploy instructions here.');
    });

    it('should handle malformed YAML gracefully', () => {
      const content = `---
name: [invalid yaml
description: {bad:
---
Some body.`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should handle missing closing delimiter', () => {
      const content = `---
name: no-close
description: No closing delimiter
Still going...`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should handle empty frontmatter', () => {
      const content = `---
---
Just body content.`;

      const result = parseSkillMdFrontmatter(content);

      // Empty YAML block returns null from js-yaml, which we handle
      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe('Just body content.');
    });

    it('should handle frontmatter with tags array', () => {
      const content = `---
name: tagged-skill
description: A tagged skill
tags:
  - github
  - code-review
---
Instructions.`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter['tags']).toEqual(['github', 'code-review']);
    });

    it('should handle leading whitespace before frontmatter', () => {
      const content = `  ---
name: leading-space
description: Has leading whitespace
---
Body.`;

      const result = parseSkillMdFrontmatter(content);

      expect(result.frontmatter['name']).toBe('leading-space');
      expect(result.body).toBe('Body.');
    });
  });

  describe('skillMdFrontmatterToMetadata', () => {
    it('should map all direct fields', () => {
      const frontmatter = {
        name: 'my-skill',
        description: 'My skill description',
        license: 'Apache-2.0',
        compatibility: 'Node.js 20+',
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Instructions here');

      expect(result.name).toBe('my-skill');
      expect(result.description).toBe('My skill description');
      expect(result.license).toBe('Apache-2.0');
      expect(result.compatibility).toBe('Node.js 20+');
      expect(result.instructions).toBe('Instructions here');
    });

    it('should map spec metadata field to specMetadata', () => {
      const frontmatter = {
        name: 'meta-skill',
        description: 'Metadata skill',
        metadata: { author: 'alice', version: '1.0', count: 42 },
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.specMetadata).toEqual({
        author: 'alice',
        version: '1.0',
        count: '42', // non-string values are stringified
      });
    });

    it('should map allowed-tools to allowedTools', () => {
      const frontmatter = {
        name: 'tools-skill',
        description: 'Tools skill',
        'allowed-tools': 'Read Edit Bash(git diff)',
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.allowedTools).toBe('Read Edit Bash(git diff)');
    });

    it('should map tags array', () => {
      const frontmatter = {
        name: 'tagged-skill',
        description: 'A tagged skill',
        tags: ['ci', 'deploy'],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.tags).toEqual(['ci', 'deploy']);
    });

    it('should not set instructions for empty body', () => {
      const result = skillMdFrontmatterToMetadata({ name: 'empty' }, '');

      expect(result.instructions).toBeUndefined();
    });

    it('should handle empty frontmatter', () => {
      const result = skillMdFrontmatterToMetadata({}, 'Just body');

      expect(result.name).toBeUndefined();
      expect(result.description).toBeUndefined();
      expect(result.instructions).toBe('Just body');
    });

    it('should map tools as string array', () => {
      const frontmatter = {
        name: 'tool-skill',
        description: 'Skill with tools',
        tools: ['read_file', 'write_file', 'run_test'],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.tools).toEqual(['read_file', 'write_file', 'run_test']);
    });

    it('should map tools as detailed refs with purpose and required', () => {
      const frontmatter = {
        name: 'ref-skill',
        description: 'Skill with tool refs',
        tools: [
          'simple_tool',
          { name: 'detailed_tool', purpose: 'Review code', required: true },
          { name: 'optional_tool', purpose: 'Format output' },
        ],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.tools).toEqual([
        'simple_tool',
        { name: 'detailed_tool', purpose: 'Review code', required: true },
        { name: 'optional_tool', purpose: 'Format output' },
      ]);
    });

    it('should skip invalid tool entries', () => {
      const frontmatter = {
        name: 'bad-tools',
        description: 'Skill with invalid tools',
        tools: ['valid_tool', 42, null, { noName: true }, { name: 'ok_tool' }],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.tools).toEqual(['valid_tool', { name: 'ok_tool' }]);
    });

    it('should map parameters array', () => {
      const frontmatter = {
        name: 'param-skill',
        description: 'Skill with params',
        parameters: [
          { name: 'target', description: 'Deploy target', type: 'string', default: 'node' },
          { name: 'verbose', type: 'boolean', required: true },
        ],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.parameters).toEqual([
        { name: 'target', description: 'Deploy target', type: 'string', default: 'node' },
        { name: 'verbose', type: 'boolean', required: true },
      ]);
    });

    it('should skip parameter entries without name', () => {
      const frontmatter = {
        name: 'bad-params',
        description: 'Skill with invalid params',
        parameters: [{ name: 'valid', description: 'Valid param' }, { description: 'Missing name' }, 'not-an-object'],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.parameters).toEqual([{ name: 'valid', description: 'Valid param' }]);
    });

    it('should map examples array', () => {
      const frontmatter = {
        name: 'example-skill',
        description: 'Skill with examples',
        examples: [
          { scenario: 'Deploy to production', parameters: { target: 'prod' }, expectedOutcome: 'App deployed' },
          { scenario: 'Run locally' },
        ],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.examples).toEqual([
        { scenario: 'Deploy to production', parameters: { target: 'prod' }, expectedOutcome: 'App deployed' },
        { scenario: 'Run locally' },
      ]);
    });

    it('should handle expected-outcome kebab-case in examples', () => {
      const frontmatter = {
        name: 'kebab-example',
        description: 'Skill with kebab-case example',
        examples: [{ scenario: 'Test case', 'expected-outcome': 'Tests pass' }],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.examples).toEqual([{ scenario: 'Test case', expectedOutcome: 'Tests pass' }]);
    });

    it('should skip example entries without scenario', () => {
      const frontmatter = {
        name: 'bad-examples',
        description: 'Skill with invalid examples',
        examples: [{ scenario: 'Valid example' }, { expectedOutcome: 'Missing scenario' }, 'not-an-object'],
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.examples).toEqual([{ scenario: 'Valid example' }]);
    });

    it('should map priority number', () => {
      const frontmatter = {
        name: 'priority-skill',
        description: 'High priority',
        priority: 10,
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.priority).toBe(10);
    });

    it('should not map non-number priority', () => {
      const frontmatter = {
        name: 'bad-priority',
        description: 'Non-number priority',
        priority: 'high',
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.priority).toBeUndefined();
    });

    it('should map visibility values', () => {
      for (const vis of ['mcp', 'http', 'both'] as const) {
        const result = skillMdFrontmatterToMetadata(
          { name: 'vis-skill', description: 'Test', visibility: vis },
          'Body',
        );
        expect(result.visibility).toBe(vis);
      }
    });

    it('should not map invalid visibility', () => {
      const result = skillMdFrontmatterToMetadata(
        { name: 'bad-vis', description: 'Test', visibility: 'invalid' },
        'Body',
      );
      expect(result.visibility).toBeUndefined();
    });

    it('should map hideFromDiscovery boolean', () => {
      const result = skillMdFrontmatterToMetadata(
        { name: 'hidden', description: 'Test', hideFromDiscovery: true },
        'Body',
      );
      expect(result.hideFromDiscovery).toBe(true);
    });

    it('should map hide-from-discovery kebab-case', () => {
      const result = skillMdFrontmatterToMetadata(
        { name: 'hidden', description: 'Test', 'hide-from-discovery': true },
        'Body',
      );
      expect(result.hideFromDiscovery).toBe(true);
    });

    it('should not map non-boolean hideFromDiscovery', () => {
      const result = skillMdFrontmatterToMetadata(
        { name: 'bad-hide', description: 'Test', hideFromDiscovery: 'yes' },
        'Body',
      );
      expect(result.hideFromDiscovery).toBeUndefined();
    });

    it('should map toolValidation values', () => {
      for (const tv of ['strict', 'warn', 'ignore'] as const) {
        const result = skillMdFrontmatterToMetadata(
          { name: 'tv-skill', description: 'Test', toolValidation: tv },
          'Body',
        );
        expect(result.toolValidation).toBe(tv);
      }
    });

    it('should map tool-validation kebab-case', () => {
      const result = skillMdFrontmatterToMetadata(
        { name: 'tv-skill', description: 'Test', 'tool-validation': 'strict' },
        'Body',
      );
      expect(result.toolValidation).toBe('strict');
    });

    it('should not map invalid toolValidation', () => {
      const result = skillMdFrontmatterToMetadata(
        { name: 'bad-tv', description: 'Test', toolValidation: 'relaxed' },
        'Body',
      );
      expect(result.toolValidation).toBeUndefined();
    });

    it('should pass unknown fields through to specMetadata', () => {
      const frontmatter = {
        name: 'provider-skill',
        description: 'Skill with provider fields',
        'user-invocable': true,
        'custom-field': 'custom-value',
        'numeric-meta': 42,
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      expect(result.specMetadata).toEqual({
        'user-invocable': 'true',
        'custom-field': 'custom-value',
        'numeric-meta': '42',
      });
    });

    it('should merge unknown fields with explicit metadata into specMetadata', () => {
      const frontmatter = {
        name: 'merge-skill',
        description: 'Test merge',
        metadata: { author: 'alice' },
        'user-invocable': true,
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, 'Body');

      // Explicit metadata maps first, unknown fields add to specMetadata
      expect(result.specMetadata!['author']).toBe('alice');
      expect(result.specMetadata!['user-invocable']).toBe('true');
    });

    it('should map all fields from a comprehensive SKILL.md frontmatter', () => {
      const frontmatter = {
        name: 'full-skill',
        description: 'A comprehensive skill',
        license: 'MIT',
        compatibility: 'Node.js 18+',
        tags: ['setup', 'redis'],
        tools: ['configure_redis', { name: 'test_connection', purpose: 'Verify Redis', required: true }],
        parameters: [{ name: 'provider', description: 'Redis provider', type: 'string', default: 'docker' }],
        examples: [{ scenario: 'Setup Redis for dev', expectedOutcome: 'Redis running on localhost:6379' }],
        priority: 5,
        visibility: 'both',
        hideFromDiscovery: false,
        toolValidation: 'strict',
        'allowed-tools': 'Read Edit',
        metadata: { version: '1.0' },
        'user-invocable': true,
      };

      const result = skillMdFrontmatterToMetadata(frontmatter, '# Setup Redis\n\nStep 1...');

      expect(result.name).toBe('full-skill');
      expect(result.description).toBe('A comprehensive skill');
      expect(result.license).toBe('MIT');
      expect(result.compatibility).toBe('Node.js 18+');
      expect(result.tags).toEqual(['setup', 'redis']);
      expect(result.tools).toEqual([
        'configure_redis',
        { name: 'test_connection', purpose: 'Verify Redis', required: true },
      ]);
      expect(result.parameters).toEqual([
        { name: 'provider', description: 'Redis provider', type: 'string', default: 'docker' },
      ]);
      expect(result.examples).toEqual([
        { scenario: 'Setup Redis for dev', expectedOutcome: 'Redis running on localhost:6379' },
      ]);
      expect(result.priority).toBe(5);
      expect(result.visibility).toBe('both');
      expect(result.hideFromDiscovery).toBe(false);
      expect(result.toolValidation).toBe('strict');
      expect(result.allowedTools).toBe('Read Edit');
      expect(result.specMetadata).toEqual({
        version: '1.0',
        'user-invocable': 'true',
      });
      expect(result.instructions).toBe('# Setup Redis\n\nStep 1...');
    });
  });

  describe('stripFrontmatter', () => {
    it('should strip frontmatter and return body only', () => {
      const content = `---
name: test
description: Test
---
Body content here.`;

      expect(stripFrontmatter(content)).toBe('Body content here.');
    });

    it('should return full content when no frontmatter', () => {
      const content = '# Just markdown\n\nNo frontmatter.';
      expect(stripFrontmatter(content)).toBe(content);
    });

    it('should return full content when missing closing delimiter', () => {
      const content = '---\nname: incomplete\nNo closing.';
      expect(stripFrontmatter(content)).toBe(content);
    });
  });
});
