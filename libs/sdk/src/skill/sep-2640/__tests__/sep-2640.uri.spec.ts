/**
 * SEP-2640 URI parsing/validation tests.
 */

import 'reflect-metadata';

import {
  buildSkillUri,
  isSkillIndexUri,
  isSkillUri,
  parseSkillUri,
  parseSkillUriWithKnownSkill,
  validateSkillPath,
} from '../sep-2640.uri';

describe('SEP-2640 URI helpers', () => {
  describe('isSkillUri', () => {
    it('accepts skill:// URIs', () => {
      expect(isSkillUri('skill://git-workflow/SKILL.md')).toBe(true);
      expect(isSkillUri('skill://acme/billing/refunds/SKILL.md')).toBe(true);
      expect(isSkillUri('skill://index.json')).toBe(true);
    });

    it('rejects other schemes', () => {
      expect(isSkillUri('skills://git-workflow')).toBe(false);
      expect(isSkillUri('https://example.com/skill')).toBe(false);
      expect(isSkillUri('file:///path/SKILL.md')).toBe(false);
      expect(isSkillUri('')).toBe(false);
    });
  });

  describe('isSkillIndexUri', () => {
    it('matches the well-known index URI exactly', () => {
      expect(isSkillIndexUri('skill://index.json')).toBe(true);
    });

    it('does not match other URIs', () => {
      expect(isSkillIndexUri('skill://index.json/')).toBe(false);
      expect(isSkillIndexUri('skill://my-skill/SKILL.md')).toBe(false);
      expect(isSkillIndexUri('skill://index')).toBe(false);
    });
  });

  describe('buildSkillUri', () => {
    it('builds flat skill URIs', () => {
      expect(buildSkillUri(['git-workflow'], 'SKILL.md')).toBe('skill://git-workflow/SKILL.md');
    });

    it('builds nested skill URIs', () => {
      expect(buildSkillUri(['acme', 'billing', 'refunds'], 'SKILL.md')).toBe('skill://acme/billing/refunds/SKILL.md');
    });

    it('builds sub-file URIs', () => {
      expect(buildSkillUri(['my-skill'], 'references/security.md')).toBe('skill://my-skill/references/security.md');
      expect(buildSkillUri(['acme', 'refunds'], 'templates/email.md')).toBe('skill://acme/refunds/templates/email.md');
    });

    it('builds directory URI without file path', () => {
      expect(buildSkillUri(['my-skill'])).toBe('skill://my-skill');
    });

    it('throws on empty segments', () => {
      expect(() => buildSkillUri([])).toThrow(/at least one segment/);
    });

    it('URI-encodes segments', () => {
      expect(buildSkillUri(['my skill'], 'SKILL.md')).toBe('skill://my%20skill/SKILL.md');
    });
  });

  describe('parseSkillUri', () => {
    it('parses flat SKILL.md URIs', () => {
      const parsed = parseSkillUri('skill://git-workflow/SKILL.md');
      expect(parsed).toEqual({
        skillPathSegments: ['git-workflow'],
        skillName: 'git-workflow',
        prefixSegments: [],
        filePathSegments: ['SKILL.md'],
        isSkillMd: true,
        skillPath: 'git-workflow',
        filePath: 'SKILL.md',
      });
    });

    it('parses nested SKILL.md URIs', () => {
      const parsed = parseSkillUri('skill://acme/billing/refunds/SKILL.md');
      expect(parsed?.skillPath).toBe('acme/billing/refunds');
      expect(parsed?.skillName).toBe('refunds');
      expect(parsed?.prefixSegments).toEqual(['acme', 'billing']);
      expect(parsed?.isSkillMd).toBe(true);
    });

    it('treats non-SKILL.md URIs as directory references (no file split)', () => {
      // Without a SKILL.md anchor we can't safely guess the boundary; the
      // dedicated `parseSkillUriWithKnownSkill` is the path for sub-files.
      const parsed = parseSkillUri('skill://my-skill/scripts/extract.py');
      expect(parsed?.isSkillMd).toBe(false);
      expect(parsed?.filePathSegments).toEqual([]);
    });

    it('rejects index URI', () => {
      expect(parseSkillUri('skill://index.json')).toBeUndefined();
    });

    it('rejects non-skill schemes', () => {
      expect(parseSkillUri('skills://my-skill')).toBeUndefined();
      expect(parseSkillUri('https://example.com')).toBeUndefined();
    });

    it('rejects empty', () => {
      expect(parseSkillUri('skill://')).toBeUndefined();
      expect(parseSkillUri('skill://////')).toBeUndefined();
    });

    it('strips query and fragment', () => {
      const parsed = parseSkillUri('skill://git-workflow/SKILL.md?ref=v1#section');
      expect(parsed?.skillName).toBe('git-workflow');
      expect(parsed?.isSkillMd).toBe(true);
    });

    it('decodes percent-encoded segments', () => {
      const parsed = parseSkillUri('skill://my%20skill/SKILL.md');
      expect(parsed?.skillName).toBe('my skill');
    });
  });

  describe('parseSkillUriWithKnownSkill', () => {
    it('correctly splits sub-file paths', () => {
      const parsed = parseSkillUriWithKnownSkill('skill://my-skill/scripts/extract.py', 'my-skill');
      expect(parsed?.skillPath).toBe('my-skill');
      expect(parsed?.filePathSegments).toEqual(['scripts', 'extract.py']);
      expect(parsed?.isSkillMd).toBe(false);
    });

    it('handles nested paths with sub-files', () => {
      const parsed = parseSkillUriWithKnownSkill(
        'skill://acme/billing/refunds/templates/email.md',
        'acme/billing/refunds',
      );
      expect(parsed?.skillPath).toBe('acme/billing/refunds');
      expect(parsed?.skillName).toBe('refunds');
      expect(parsed?.filePathSegments).toEqual(['templates', 'email.md']);
    });

    it('returns undefined when path mismatch', () => {
      expect(parseSkillUriWithKnownSkill('skill://other-skill/SKILL.md', 'my-skill')).toBeUndefined();
    });

    it('detects SKILL.md correctly', () => {
      const parsed = parseSkillUriWithKnownSkill('skill://my-skill/SKILL.md', 'my-skill');
      expect(parsed?.isSkillMd).toBe(true);
    });
  });

  describe('validateSkillPath', () => {
    it('accepts a single-segment path matching the name', () => {
      expect(validateSkillPath('git-workflow', 'git-workflow')).toEqual(['git-workflow']);
    });

    it('accepts a multi-segment path with matching final', () => {
      expect(validateSkillPath('acme/billing/refunds', 'refunds')).toEqual(['acme', 'billing', 'refunds']);
    });

    it('rejects when final segment does not match name', () => {
      expect(() => validateSkillPath('acme/billing/refunds', 'returns')).toThrow(/must match frontmatter name/);
    });

    it('rejects names violating Agent Skills naming rules', () => {
      expect(() => validateSkillPath('acme/Billing-Refunds', 'Billing-Refunds')).toThrow(/naming rules/);
    });

    it('rejects consecutive hyphens', () => {
      expect(() => validateSkillPath('foo--bar', 'foo--bar')).toThrow(/consecutive hyphens/);
    });

    it('rejects empty path', () => {
      expect(() => validateSkillPath('', 'git')).toThrow(/at least one segment/);
      expect(() => validateSkillPath('///', 'git')).toThrow(/at least one segment/);
    });
  });
});
