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
