/**
 * Skill Directory Loader Tests
 */

import { loadSkillDirectory, scanSkillResources, skillDir } from '../skill-directory-loader';
import { SkillKind } from '../../common/records/skill.record';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => ({
  readFile: jest.fn(),
  fileExists: jest.fn(),
  stat: jest.fn(),
  joinPath: (...parts: string[]) =>
    parts
      .map((p) => p.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
      .replace(/^/, '/'),
  randomBytes: (n: number) => new Uint8Array(n),
  bytesToHex: (bytes: Uint8Array) =>
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
}));

import { readFile, fileExists, stat } from '@frontmcp/utils';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockFileExists = fileExists as jest.MockedFunction<typeof fileExists>;
const mockStat = stat as jest.MockedFunction<typeof stat>;

function enoent(path: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, stat '${path}'`);
  err.code = 'ENOENT';
  return err;
}

describe('skill-directory-loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scanSkillResources', () => {
    it('should detect all resource directories', async () => {
      mockStat.mockImplementation(async (path: string) => {
        if (
          path === '/skills/my-skill/scripts' ||
          path === '/skills/my-skill/references' ||
          path === '/skills/my-skill/assets'
        ) {
          return { isDirectory: () => true } as any;
        }
        throw enoent(path);
      });
      mockFileExists.mockResolvedValue(true);

      const result = await scanSkillResources('/skills/my-skill');

      expect(result.resources.scripts).toBe('/skills/my-skill/scripts');
      expect(result.resources.references).toBe('/skills/my-skill/references');
      expect(result.resources.assets).toBe('/skills/my-skill/assets');
      expect(result.hasSkillMd).toBe(true);
    });

    it('should handle missing optional directories', async () => {
      mockStat.mockRejectedValue(enoent('/skills/my-skill'));
      mockFileExists.mockResolvedValue(true);

      const result = await scanSkillResources('/skills/my-skill');

      expect(result.resources.scripts).toBeUndefined();
      expect(result.resources.references).toBeUndefined();
      expect(result.resources.assets).toBeUndefined();
      expect(result.hasSkillMd).toBe(true);
    });

    it('should detect partial resource directories', async () => {
      mockStat.mockImplementation(async (path: string) => {
        if (path === '/skills/my-skill/scripts') {
          return { isDirectory: () => true } as any;
        }
        throw enoent(path);
      });
      mockFileExists.mockResolvedValue(false);

      const result = await scanSkillResources('/skills/my-skill');

      expect(result.resources.scripts).toBe('/skills/my-skill/scripts');
      expect(result.resources.references).toBeUndefined();
      expect(result.resources.assets).toBeUndefined();
      expect(result.hasSkillMd).toBe(false);
    });

    it('should re-throw non-ENOENT errors from stat', async () => {
      const permErr: NodeJS.ErrnoException = new Error('permission denied');
      permErr.code = 'EACCES';
      mockStat.mockRejectedValue(permErr);
      mockFileExists.mockResolvedValue(true);

      await expect(scanSkillResources('/skills/my-skill')).rejects.toThrow('permission denied');
    });

    it('should handle files that are not directories', async () => {
      mockStat.mockImplementation(async () => {
        return { isDirectory: () => false } as any;
      });
      mockFileExists.mockResolvedValue(true);

      const result = await scanSkillResources('/skills/my-skill');

      expect(result.resources.scripts).toBeUndefined();
      expect(result.resources.references).toBeUndefined();
      expect(result.resources.assets).toBeUndefined();
    });
  });

  describe('loadSkillDirectory', () => {
    const validSkillMd = `---
name: review-pr
description: Review a GitHub pull request
license: MIT
tags:
  - github
  - code-review
---
# Instructions

Step 1: Fetch the PR
Step 2: Review code`;

    it('should load skill directory with SKILL.md', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(validSkillMd);
      mockStat.mockRejectedValue(enoent('/skills/review-pr'));

      const result = await loadSkillDirectory('/skills/review-pr');

      expect(result.kind).toBe(SkillKind.FILE);
      expect(result.metadata.name).toBe('review-pr');
      expect(result.metadata.description).toBe('Review a GitHub pull request');
      expect(result.metadata.license).toBe('MIT');
      expect(result.metadata.tags).toEqual(['github', 'code-review']);
      expect(result.filePath).toBe('/skills/review-pr/SKILL.md');
      expect(typeof result.provide).toBe('symbol');
    });

    it('should auto-detect scripts/ and assets/ directories', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(validSkillMd);
      mockStat.mockImplementation(async (path: string) => {
        if (path === '/skills/review-pr/scripts' || path === '/skills/review-pr/assets') {
          return { isDirectory: () => true } as any;
        }
        throw enoent(path);
      });

      const result = await loadSkillDirectory('/skills/review-pr');

      expect(result.metadata.resources).toBeDefined();
      expect(result.metadata.resources?.scripts).toBe('/skills/review-pr/scripts');
      expect(result.metadata.resources?.assets).toBe('/skills/review-pr/assets');
      expect(result.metadata.resources?.references).toBeUndefined();
    });

    it('should throw error when SKILL.md is missing', async () => {
      mockFileExists.mockResolvedValue(false);

      await expect(loadSkillDirectory('/skills/no-skill')).rejects.toThrow('SKILL.md not found in directory');
    });

    it('should wrap readFile errors in InvalidSkillError', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockRejectedValue(new Error('disk read error'));
      mockStat.mockRejectedValue(enoent('/skills/bad-read'));

      await expect(loadSkillDirectory('/skills/bad-read')).rejects.toThrow(
        'Failed to read or parse SKILL.md: disk read error',
      );
    });

    it('should throw error when name is missing from frontmatter', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(`---
description: A skill without name
---
Instructions.`);
      mockStat.mockRejectedValue(enoent('/skills/missing-name'));

      await expect(loadSkillDirectory('/skills/missing-name')).rejects.toThrow("missing required 'name' field");
    });

    it('should throw error when description is missing from frontmatter', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(`---
name: no-desc
---
Instructions.`);
      mockStat.mockRejectedValue(enoent('/skills/no-desc'));

      await expect(loadSkillDirectory('/skills/no-desc')).rejects.toThrow("missing required 'description' field");
    });

    it('should throw error when body is empty (no instructions)', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(`---
name: no-body
description: A skill with empty body
---`);
      mockStat.mockRejectedValue(enoent('/skills/no-body'));

      await expect(loadSkillDirectory('/skills/no-body')).rejects.toThrow('no body content for instructions');
    });
  });

  describe('skillDir', () => {
    it('should be an alias for loadSkillDirectory', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue(`---
name: alias-test
description: Testing the alias
---
Instructions.`);
      mockStat.mockRejectedValue(enoent('/skills/alias-test'));

      const result = await skillDir('/skills/alias-test');

      expect(result.kind).toBe(SkillKind.FILE);
      expect(result.metadata.name).toBe('alias-test');
    });
  });
});
