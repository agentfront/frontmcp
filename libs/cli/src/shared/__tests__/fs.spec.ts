// file: libs/cli/src/shared/__tests__/fs.spec.ts

import * as path from 'path';

// Mock @frontmcp/utils
jest.mock('@frontmcp/utils', () => {
  return {
    fileExists: jest.fn(),
    readJSON: jest.fn(),
  };
});

import { resolveEntry } from '../fs';
import { fileExists, readJSON } from '@frontmcp/utils';

describe('fs utilities', () => {
  const cwd = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveEntry', () => {
    it('should return explicit entry if it exists', async () => {
      (fileExists as jest.Mock).mockResolvedValue(true);

      const result = await resolveEntry(cwd, 'custom/entry.ts');

      expect(result).toBe(path.resolve(cwd, 'custom/entry.ts'));
      expect(fileExists).toHaveBeenCalledWith(path.resolve(cwd, 'custom/entry.ts'));
    });

    it('should throw if explicit entry does not exist', async () => {
      (fileExists as jest.Mock).mockResolvedValue(false);

      await expect(resolveEntry(cwd, 'missing/entry.ts')).rejects.toThrow('Entry override not found: missing/entry.ts');
    });

    it('should resolve from package.json main field', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src/index.ts' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.resolve(cwd, 'src/index.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.resolve(cwd, 'src/index.ts'));
    });

    it('should try extensions for main field without extension', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src/main' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.resolve(cwd, 'src/main.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.resolve(cwd, 'src/main.ts'));
    });

    it('should try index files if main is a directory', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.join(cwd, 'src', 'index.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.join(cwd, 'src', 'index.ts'));
    });

    it('should fallback to src/main.ts', async () => {
      (readJSON as jest.Mock).mockResolvedValue(null);
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return false;
        if (p === path.join(cwd, 'src', 'main.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.join(cwd, 'src', 'main.ts'));
    });

    it('should throw detailed error if no entry found', async () => {
      (readJSON as jest.Mock).mockResolvedValue(null);
      (fileExists as jest.Mock).mockResolvedValue(false);

      await expect(resolveEntry(cwd)).rejects.toThrow('No entry file found');
    });

    it('should handle package.json with empty main', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: '' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.join(cwd, 'src', 'main.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.join(cwd, 'src', 'main.ts'));
    });

    it('should handle package.json with whitespace-only main', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: '   ' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.join(cwd, 'src', 'main.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.join(cwd, 'src', 'main.ts'));
    });

    it('should try .tsx extension', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src/app' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.resolve(cwd, 'src/app.tsx')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.resolve(cwd, 'src/app.tsx'));
    });

    it('should try .js extension', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src/app' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.resolve(cwd, 'src/app.js')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.resolve(cwd, 'src/app.js'));
    });

    it('should try .mjs extension', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src/app' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.resolve(cwd, 'src/app.mjs')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.resolve(cwd, 'src/app.mjs'));
    });

    it('should try .cjs extension', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 'src/app' });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.resolve(cwd, 'src/app.cjs')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.resolve(cwd, 'src/app.cjs'));
    });

    it('should handle package.json with non-string main', async () => {
      (readJSON as jest.Mock).mockResolvedValue({ main: 123 });
      (fileExists as jest.Mock).mockImplementation(async (p: string) => {
        if (p === path.join(cwd, 'package.json')) return true;
        if (p === path.join(cwd, 'src', 'main.ts')) return true;
        return false;
      });

      const result = await resolveEntry(cwd);

      expect(result).toBe(path.join(cwd, 'src', 'main.ts'));
    });
  });
});
