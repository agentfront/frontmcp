import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileExists, readJSON, writeJSON, ensureDir, isDirEmpty, runCmd } from './fs';

describe('FS Utils', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'utils-test-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(filePath, 'content');

      expect(await fileExists(filePath)).toBe(true);
    });

    it('should return false for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');

      expect(await fileExists(filePath)).toBe(false);
    });

    it('should return true for existing directory', async () => {
      expect(await fileExists(tempDir)).toBe(true);
    });
  });

  describe('readJSON', () => {
    it('should read and parse JSON file', async () => {
      const filePath = path.join(tempDir, 'data.json');
      await fs.promises.writeFile(filePath, '{"key": "value", "num": 42}');

      const result = await readJSON<{ key: string; num: number }>(filePath);

      expect(result).toEqual({ key: 'value', num: 42 });
    });

    it('should return null for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.json');

      expect(await readJSON(filePath)).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      const filePath = path.join(tempDir, 'invalid.json');
      await fs.promises.writeFile(filePath, 'not valid json');

      expect(await readJSON(filePath)).toBeNull();
    });
  });

  describe('writeJSON', () => {
    it('should write JSON with pretty formatting', async () => {
      const filePath = path.join(tempDir, 'output.json');
      const data = { key: 'value', nested: { a: 1 } };

      await writeJSON(filePath, data);

      const content = await fs.promises.readFile(filePath, 'utf8');
      expect(content).toBe(JSON.stringify(data, null, 2) + '\n');
    });

    it('should overwrite existing file', async () => {
      const filePath = path.join(tempDir, 'output.json');
      await fs.promises.writeFile(filePath, '{"old": true}');

      await writeJSON(filePath, { new: true });

      const result = await readJSON(filePath);
      expect(result).toEqual({ new: true });
    });
  });

  describe('ensureDir', () => {
    it('should create directory if not exists', async () => {
      const dirPath = path.join(tempDir, 'new', 'nested', 'dir');

      await ensureDir(dirPath);

      expect(await fileExists(dirPath)).toBe(true);
    });

    it('should not throw if directory exists', async () => {
      await expect(ensureDir(tempDir)).resolves.not.toThrow();
    });
  });

  describe('isDirEmpty', () => {
    it('should return true for empty directory', async () => {
      expect(await isDirEmpty(tempDir)).toBe(true);
    });

    it('should return false for non-empty directory', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'file.txt'), 'content');

      expect(await isDirEmpty(tempDir)).toBe(false);
    });

    it('should return true for non-existing directory', async () => {
      const nonExistent = path.join(tempDir, 'nonexistent');

      expect(await isDirEmpty(nonExistent)).toBe(true);
    });
  });

  describe('runCmd', () => {
    it('should resolve for successful command', async () => {
      await expect(runCmd('echo', ['hello'])).resolves.not.toThrow();
    });

    it('should reject for failed command', async () => {
      await expect(runCmd('false', [])).rejects.toThrow('exited with code');
    });

    it('should reject for non-existing command', async () => {
      await expect(runCmd('nonexistent-command-xyz', [])).rejects.toThrow();
    });

    it('should use cwd option', async () => {
      await expect(runCmd('pwd', [], { cwd: tempDir })).resolves.not.toThrow();
    });
  });
});
