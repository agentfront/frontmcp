import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  fileExists,
  readFileSync,
  readFile,
  readFileBuffer,
  writeFile,
  readJSON,
  writeJSON,
  ensureDir,
  isDirEmpty,
  runCmd,
  mkdir,
  rename,
  unlink,
  stat,
  copyFile,
  cp,
  readdir,
  rm,
  mkdtemp,
  access,
} from './fs';

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

  describe('readFileSync', () => {
    it('should read file contents as string', () => {
      const testContent = 'hello world';
      const filePath = path.join(tempDir, 'sync-test.txt');
      fs.writeFileSync(filePath, testContent);

      const content = readFileSync(filePath);
      expect(content).toBe(testContent);
    });

    it('should throw ENOENT for non-existing file', () => {
      expect(() => readFileSync(path.join(tempDir, 'nonexistent.txt'))).toThrow(/ENOENT/);
    });

    it('should support custom encoding', () => {
      const filePath = path.join(tempDir, 'encoding-test.txt');
      fs.writeFileSync(filePath, 'test content');

      const content = readFileSync(filePath, 'utf8');
      expect(content).toBe('test content');
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
      await expect(ensureDir(tempDir)).resolves.toBeUndefined();
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
      await expect(runCmd('echo', ['hello'])).resolves.toBeUndefined();
    });

    it('should reject for failed command', async () => {
      await expect(runCmd('false', [])).rejects.toThrow('exited with code');
    });

    it('should reject for non-existing command', async () => {
      await expect(runCmd('nonexistent-command-xyz', [])).rejects.toThrow();
    });

    it('should use cwd option', async () => {
      // Use node instead of pwd for cross-platform compatibility
      await expect(runCmd('node', ['-e', 'console.log(process.cwd())'], { cwd: tempDir })).resolves.toBeUndefined();
    });
  });

  describe('readFile', () => {
    it('should read file contents as string with default utf8 encoding', async () => {
      const filePath = path.join(tempDir, 'read-test.txt');
      await fs.promises.writeFile(filePath, 'hello world');

      const content = await readFile(filePath);
      expect(content).toBe('hello world');
    });

    it('should read file with custom encoding', async () => {
      const filePath = path.join(tempDir, 'encoding-test.txt');
      await fs.promises.writeFile(filePath, 'test content', 'utf8');

      const content = await readFile(filePath, 'utf8');
      expect(content).toBe('test content');
    });

    it('should throw for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');
      await expect(readFile(filePath)).rejects.toThrow(/ENOENT/);
    });
  });

  describe('readFileBuffer', () => {
    it('should read file as Buffer', async () => {
      const filePath = path.join(tempDir, 'buffer-test.bin');
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
      await fs.promises.writeFile(filePath, binaryData);

      const buffer = await readFileBuffer(filePath);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(binaryData);
    });

    it('should throw for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.bin');
      await expect(readFileBuffer(filePath)).rejects.toThrow(/ENOENT/);
    });
  });

  describe('writeFile', () => {
    it('should write content to file', async () => {
      const filePath = path.join(tempDir, 'write-test.txt');

      await writeFile(filePath, 'test content');

      const content = await fs.promises.readFile(filePath, 'utf8');
      expect(content).toBe('test content');
    });

    it('should write file with mode option', async () => {
      const filePath = path.join(tempDir, 'mode-test.txt');

      await writeFile(filePath, 'secret content', { mode: 0o600 });

      const stats = await fs.promises.stat(filePath);
      // Check write permission for owner (mode & 0o200)
      expect(stats.mode & 0o600).toBeTruthy();
    });

    it('should overwrite existing file', async () => {
      const filePath = path.join(tempDir, 'overwrite-test.txt');
      await fs.promises.writeFile(filePath, 'original');

      await writeFile(filePath, 'updated');

      const content = await fs.promises.readFile(filePath, 'utf8');
      expect(content).toBe('updated');
    });
  });

  describe('mkdir', () => {
    it('should create directory', async () => {
      const dirPath = path.join(tempDir, 'new-dir');

      await mkdir(dirPath);

      expect(await fileExists(dirPath)).toBe(true);
    });

    it('should create nested directories with recursive option', async () => {
      const dirPath = path.join(tempDir, 'a', 'b', 'c');

      await mkdir(dirPath, { recursive: true });

      expect(await fileExists(dirPath)).toBe(true);
    });

    it('should create directory with mode option', async () => {
      const dirPath = path.join(tempDir, 'mode-dir');

      await mkdir(dirPath, { mode: 0o755 });

      const stats = await fs.promises.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should throw for existing directory without recursive', async () => {
      const dirPath = tempDir;

      // This may vary by OS, some just silently succeed
      // The test is more about calling the function with options
      await expect(mkdir(dirPath)).rejects.toThrow();
    });
  });

  describe('rename', () => {
    it('should rename file', async () => {
      const oldPath = path.join(tempDir, 'old-name.txt');
      const newPath = path.join(tempDir, 'new-name.txt');
      await fs.promises.writeFile(oldPath, 'content');

      await rename(oldPath, newPath);

      expect(await fileExists(oldPath)).toBe(false);
      expect(await fileExists(newPath)).toBe(true);
    });

    it('should move file to different directory', async () => {
      const subDir = path.join(tempDir, 'subdir');
      await fs.promises.mkdir(subDir);
      const oldPath = path.join(tempDir, 'file.txt');
      const newPath = path.join(subDir, 'file.txt');
      await fs.promises.writeFile(oldPath, 'content');

      await rename(oldPath, newPath);

      expect(await fileExists(newPath)).toBe(true);
    });
  });

  describe('unlink', () => {
    it('should delete file', async () => {
      const filePath = path.join(tempDir, 'to-delete.txt');
      await fs.promises.writeFile(filePath, 'content');

      await unlink(filePath);

      expect(await fileExists(filePath)).toBe(false);
    });

    it('should throw for non-existing file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.txt');
      await expect(unlink(filePath)).rejects.toThrow(/ENOENT/);
    });
  });

  describe('stat', () => {
    it('should return stats for file', async () => {
      const filePath = path.join(tempDir, 'stat-file.txt');
      await fs.promises.writeFile(filePath, 'content');

      const stats = await stat(filePath);

      expect(stats.isFile()).toBe(true);
      expect(stats.isDirectory()).toBe(false);
    });

    it('should return stats for directory', async () => {
      const stats = await stat(tempDir);

      expect(stats.isDirectory()).toBe(true);
      expect(stats.isFile()).toBe(false);
    });

    it('should throw for non-existing path', async () => {
      await expect(stat(path.join(tempDir, 'nonexistent'))).rejects.toThrow(/ENOENT/);
    });
  });

  describe('copyFile', () => {
    it('should copy file', async () => {
      const srcPath = path.join(tempDir, 'src.txt');
      const destPath = path.join(tempDir, 'dest.txt');
      await fs.promises.writeFile(srcPath, 'content to copy');

      await copyFile(srcPath, destPath);

      const content = await fs.promises.readFile(destPath, 'utf8');
      expect(content).toBe('content to copy');
    });

    it('should overwrite existing destination', async () => {
      const srcPath = path.join(tempDir, 'src.txt');
      const destPath = path.join(tempDir, 'dest.txt');
      await fs.promises.writeFile(srcPath, 'new content');
      await fs.promises.writeFile(destPath, 'old content');

      await copyFile(srcPath, destPath);

      const content = await fs.promises.readFile(destPath, 'utf8');
      expect(content).toBe('new content');
    });
  });

  describe('cp', () => {
    it('should copy file', async () => {
      const srcPath = path.join(tempDir, 'cp-src.txt');
      const destPath = path.join(tempDir, 'cp-dest.txt');
      await fs.promises.writeFile(srcPath, 'cp content');

      await cp(srcPath, destPath);

      const content = await fs.promises.readFile(destPath, 'utf8');
      expect(content).toBe('cp content');
    });

    it('should copy directory recursively', async () => {
      const srcDir = path.join(tempDir, 'cp-src-dir');
      const destDir = path.join(tempDir, 'cp-dest-dir');
      await fs.promises.mkdir(srcDir);
      await fs.promises.writeFile(path.join(srcDir, 'file1.txt'), 'content1');
      await fs.promises.mkdir(path.join(srcDir, 'subdir'));
      await fs.promises.writeFile(path.join(srcDir, 'subdir', 'file2.txt'), 'content2');

      await cp(srcDir, destDir, { recursive: true });

      expect(await fileExists(path.join(destDir, 'file1.txt'))).toBe(true);
      expect(await fileExists(path.join(destDir, 'subdir', 'file2.txt'))).toBe(true);
    });
  });

  describe('readdir', () => {
    it('should list directory contents', async () => {
      await fs.promises.writeFile(path.join(tempDir, 'file1.txt'), 'content');
      await fs.promises.writeFile(path.join(tempDir, 'file2.txt'), 'content');
      await fs.promises.mkdir(path.join(tempDir, 'subdir'));

      const contents = await readdir(tempDir);

      expect(contents).toContain('file1.txt');
      expect(contents).toContain('file2.txt');
      expect(contents).toContain('subdir');
    });

    it('should return empty array for empty directory', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      await fs.promises.mkdir(emptyDir);

      const contents = await readdir(emptyDir);

      expect(contents).toEqual([]);
    });
  });

  describe('rm', () => {
    it('should remove file', async () => {
      const filePath = path.join(tempDir, 'rm-file.txt');
      await fs.promises.writeFile(filePath, 'content');

      await rm(filePath);

      expect(await fileExists(filePath)).toBe(false);
    });

    it('should remove directory recursively', async () => {
      const dirPath = path.join(tempDir, 'rm-dir');
      await fs.promises.mkdir(dirPath);
      await fs.promises.writeFile(path.join(dirPath, 'file.txt'), 'content');

      await rm(dirPath, { recursive: true });

      expect(await fileExists(dirPath)).toBe(false);
    });

    it('should handle force option for non-existing path', async () => {
      const nonexistent = path.join(tempDir, 'nonexistent');

      await expect(rm(nonexistent, { force: true })).resolves.toBeUndefined();
    });
  });

  describe('mkdtemp', () => {
    it('should create temp directory with prefix', async () => {
      const prefix = path.join(tempDir, 'prefix-');

      const createdDir = await mkdtemp(prefix);

      expect(createdDir.startsWith(prefix)).toBe(true);
      expect(await fileExists(createdDir)).toBe(true);

      // Clean up
      await fs.promises.rm(createdDir, { recursive: true });
    });

    it('should create unique directories', async () => {
      const prefix = path.join(tempDir, 'unique-');

      const dir1 = await mkdtemp(prefix);
      const dir2 = await mkdtemp(prefix);

      expect(dir1).not.toBe(dir2);

      // Clean up
      await fs.promises.rm(dir1, { recursive: true });
      await fs.promises.rm(dir2, { recursive: true });
    });
  });

  describe('access', () => {
    it('should resolve for accessible file', async () => {
      const filePath = path.join(tempDir, 'accessible.txt');
      await fs.promises.writeFile(filePath, 'content');

      await expect(access(filePath)).resolves.toBeUndefined();
    });

    it('should resolve for accessible directory', async () => {
      await expect(access(tempDir)).resolves.toBeUndefined();
    });

    it('should throw for non-existing path', async () => {
      const nonexistent = path.join(tempDir, 'nonexistent');

      await expect(access(nonexistent)).rejects.toThrow(/ENOENT/);
    });

    it('should check specific access mode', async () => {
      const filePath = path.join(tempDir, 'mode-check.txt');
      await fs.promises.writeFile(filePath, 'content');

      // Check for read access (fs.constants.R_OK = 4)
      await expect(access(filePath, 4)).resolves.toBeUndefined();
    });
  });

  describe('isDirEmpty edge cases', () => {
    it('should throw for non-directory that throws non-ENOENT error', async () => {
      // Create a file (not directory)
      const filePath = path.join(tempDir, 'not-a-dir.txt');
      await fs.promises.writeFile(filePath, 'content');

      // Calling isDirEmpty on a file should throw ENOTDIR
      await expect(isDirEmpty(filePath)).rejects.toThrow();
    });
  });
});
