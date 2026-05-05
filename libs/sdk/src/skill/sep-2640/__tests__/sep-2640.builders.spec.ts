/**
 * SEP-2640 builders tests — index document construction and SKILL.md
 * round-trip serialisation.
 */

import 'reflect-metadata';

import * as yaml from 'js-yaml';

import type { SkillContent } from '../../../common/interfaces';
import {
  buildArchiveIndexEntry,
  buildResourceTemplateIndexEntry,
  buildSkillIndex,
  buildSkillMdIndexEntry,
  serializeSkillMd,
} from '../sep-2640.builders';
import { SKILL_INDEX_SCHEMA_URI } from '../sep-2640.constants';

describe('SEP-2640 builders', () => {
  describe('buildSkillMdIndexEntry', () => {
    it('builds a flat skill-md entry', () => {
      const entry = buildSkillMdIndexEntry({ name: 'git-workflow', description: 'Git workflow' });
      expect(entry).toEqual({
        type: 'skill-md',
        name: 'git-workflow',
        description: 'Git workflow',
        url: 'skill://git-workflow/SKILL.md',
      });
    });

    it('builds a nested skill-md entry', () => {
      const entry = buildSkillMdIndexEntry({
        name: 'refunds',
        description: 'Refund handling',
        skillPathSegments: ['acme', 'billing', 'refunds'],
      });
      expect(entry.url).toBe('skill://acme/billing/refunds/SKILL.md');
      expect(entry.name).toBe('refunds');
    });
  });

  describe('buildResourceTemplateIndexEntry', () => {
    it('builds a template entry', () => {
      const entry = buildResourceTemplateIndexEntry('Per-product docs', 'skill://docs/{product}/SKILL.md');
      expect(entry.type).toBe('mcp-resource-template');
      expect(entry.name).toBeUndefined();
      expect(entry.url).toBe('skill://docs/{product}/SKILL.md');
    });
  });

  describe('buildArchiveIndexEntry', () => {
    it('builds an archive entry', () => {
      const entry = buildArchiveIndexEntry('Packed refunds skill', 'skill://acme/billing/refunds.zip', 'refunds');
      expect(entry.type).toBe('archive');
      expect(entry.url).toBe('skill://acme/billing/refunds.zip');
      expect(entry.name).toBe('refunds');
    });

    it('omits name when not provided', () => {
      const entry = buildArchiveIndexEntry('A bundle', 'skill://x.zip');
      expect(entry.name).toBeUndefined();
    });
  });

  describe('buildSkillIndex', () => {
    it('wraps entries with the SEP schema URI', () => {
      const doc = buildSkillIndex([
        buildSkillMdIndexEntry({ name: 'a', description: 'A' }),
        buildSkillMdIndexEntry({ name: 'b', description: 'B' }),
      ]);
      expect(doc.$schema).toBe(SKILL_INDEX_SCHEMA_URI);
      expect(doc.skills).toHaveLength(2);
    });

    it('produces valid JSON', () => {
      const doc = buildSkillIndex([buildSkillMdIndexEntry({ name: 'a', description: 'A' })]);
      const round = JSON.parse(JSON.stringify(doc));
      expect(round).toEqual(doc);
    });
  });

  describe('serializeSkillMd', () => {
    it('emits frontmatter with required fields first', () => {
      const skill: SkillContent = {
        id: 'demo',
        name: 'demo',
        description: 'Demo skill',
        instructions: '# Step 1\nDo a thing',
        tools: [],
      };
      const md = serializeSkillMd(skill);
      expect(md).toMatch(/^---\nname: demo\ndescription: Demo skill\n---\n/);
      expect(md).toContain('# Step 1\nDo a thing');
    });

    it('includes spec fields when present', () => {
      const skill: SkillContent = {
        id: 'demo',
        name: 'demo',
        description: 'Demo',
        instructions: 'body',
        tools: [
          { name: 'github_get_pr', purpose: 'fetch PR' },
          { name: 'github_add_comment', required: true },
          { name: 'simple-tool' },
        ],
        license: 'MIT',
        compatibility: 'Node 20+',
        allowedTools: 'Read Edit Bash(git status)',
        specMetadata: { docs: 'https://example.com' },
      };
      const md = serializeSkillMd(skill);
      const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) {
        throw new Error('Expected SKILL.md frontmatter block');
      }
      const fm = yaml.load(fmMatch[1]) as Record<string, unknown>;
      expect(fm['license']).toBe('MIT');
      expect(fm['compatibility']).toBe('Node 20+');
      expect(fm['allowed-tools']).toBe('Read Edit Bash(git status)');
      expect(fm['metadata']).toEqual({ docs: 'https://example.com' });
      expect(fm['tools']).toEqual([
        { name: 'github_get_pr', purpose: 'fetch PR' },
        { name: 'github_add_comment', required: true },
        'simple-tool',
      ]);
    });

    it('round-trips through frontmatter parser', () => {
      const skill: SkillContent = {
        id: 'rt',
        name: 'rt',
        description: 'Round-trip test',
        instructions: '# Heading\n\nBody paragraph.',
        tools: [],
      };
      const md = serializeSkillMd(skill);
      // The body must be exactly preserved after the frontmatter block.
      expect(md).toContain('# Heading\n\nBody paragraph.');
    });

    it('uses rawInstructions when provided', () => {
      const skill: SkillContent = {
        id: 'rt',
        name: 'rt',
        description: 'Test',
        instructions: 'body with auto-appended references',
        tools: [],
      };
      const md = serializeSkillMd(skill, '# Original\noriginal body');
      expect(md).toContain('# Original\noriginal body');
      expect(md).not.toContain('body with auto-appended references');
    });
  });
});
