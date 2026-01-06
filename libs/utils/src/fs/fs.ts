/**
 * File system utilities for common async operations.
 *
 * Provides Promise-based wrappers for file system operations.
 *
 * **Note:** These functions are Node.js only and will throw an error
 * if called in a browser environment.
 */

import { assertNode } from '../crypto/runtime';

// Lazy-loaded Node.js modules to avoid import errors in browser
let _fs: typeof import('fs') | null = null;
let _fsp: typeof import('fs').promises | null = null;
let _spawn: typeof import('child_process').spawn | null = null;

function getFs(): typeof import('fs') {
  if (!_fs) {
    assertNode('File system operations');

    _fs = require('fs');
  }
  return _fs!;
}

function getFsp(): typeof import('fs').promises {
  if (!_fsp) {
    assertNode('File system operations');

    _fsp = require('fs').promises;
  }
  return _fsp!;
}

function getSpawn(): typeof import('child_process').spawn {
  if (!_spawn) {
    assertNode('Child process operations');

    _spawn = require('child_process').spawn;
  }
  return _spawn!;
}

// fs.constants.F_OK is always 0 in Node.js - define locally to avoid lazy-load in fileExists
const F_OK = 0;

/**
 * Read a file's contents as a string.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to file
 * @param encoding - Encoding (default 'utf8')
 * @returns File contents as string
 *
 * @example
 * const content = await readFile('/path/to/file.txt');
 */
export async function readFile(p: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  const fsp = getFsp();
  return fsp.readFile(p, encoding);
}

/**
 * Read a file's contents as a Buffer.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to file
 * @returns File contents as Buffer
 *
 * @example
 * const buffer = await readFileBuffer('/path/to/file.bin');
 */
export async function readFileBuffer(p: string): Promise<Buffer> {
  const fsp = getFsp();
  return fsp.readFile(p);
}

/**
 * Write content to a file.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to write to
 * @param content - Content to write
 * @param options - Optional mode (permissions)
 *
 * @example
 * await writeFile('/path/to/file.txt', 'hello', { mode: 0o600 });
 */
export async function writeFile(p: string, content: string, options?: { mode?: number }): Promise<void> {
  const fsp = getFsp();
  await fsp.writeFile(p, content, { encoding: 'utf8', mode: options?.mode });
}

/**
 * Create a directory with optional mode (permissions).
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to directory
 * @param options - Optional recursive and mode settings
 *
 * @example
 * await mkdir('/path/to/dir', { recursive: true, mode: 0o700 });
 */
export async function mkdir(p: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
  const fsp = getFsp();
  await fsp.mkdir(p, options);
}

/**
 * Rename/move a file or directory.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param oldPath - Current path
 * @param newPath - New path
 *
 * @example
 * await rename('/path/to/old.txt', '/path/to/new.txt');
 */
export async function rename(oldPath: string, newPath: string): Promise<void> {
  const fsp = getFsp();
  await fsp.rename(oldPath, newPath);
}

/**
 * Delete a file.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to file to delete
 *
 * @example
 * await unlink('/path/to/file.txt');
 */
export async function unlink(p: string): Promise<void> {
  const fsp = getFsp();
  await fsp.unlink(p);
}

/**
 * Check if a file exists asynchronously.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to check
 * @returns true if file exists, false otherwise
 *
 * @example
 * await fileExists('/path/to/file.txt') // true or false
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    const fsp = getFsp();
    await fsp.access(p, F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON file.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param jsonPath - Path to JSON file
 * @returns Parsed JSON content, or null if file doesn't exist or is invalid
 *
 * @example
 * const config = await readJSON<Config>('/path/to/config.json');
 */
export async function readJSON<T = unknown>(jsonPath: string): Promise<T | null> {
  try {
    const fsp = getFsp();
    const buf = await fsp.readFile(jsonPath, 'utf8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

/**
 * Write an object to a JSON file with pretty formatting.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to write to
 * @param obj - Object to serialize
 *
 * @example
 * await writeJSON('/path/to/output.json', { key: 'value' });
 */
export async function writeJSON(p: string, obj: unknown): Promise<void> {
  const fsp = getFsp();
  await fsp.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to directory
 *
 * @example
 * await ensureDir('/path/to/new/directory');
 */
export async function ensureDir(p: string): Promise<void> {
  const fsp = getFsp();
  await fsp.mkdir(p, { recursive: true });
}

/**
 * Get file/directory stats.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to file or directory
 * @returns Stats object with isDirectory(), isFile(), etc.
 *
 * @example
 * const stats = await stat('/path/to/file');
 * if (stats.isDirectory()) { ... }
 */
export async function stat(p: string): Promise<import('fs').Stats> {
  const fsp = getFsp();
  return fsp.stat(p);
}

/**
 * Copy a file.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param src - Source path
 * @param dest - Destination path
 *
 * @example
 * await copyFile('/path/to/src', '/path/to/dest');
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  const fsp = getFsp();
  await fsp.copyFile(src, dest);
}

/**
 * Copy a file or directory recursively.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param src - Source path
 * @param dest - Destination path
 * @param options - Copy options
 *
 * @example
 * await cp('/path/to/src', '/path/to/dest', { recursive: true });
 */
export async function cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> {
  const fsp = getFsp();
  await fsp.cp(src, dest, options);
}

/**
 * List directory contents.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to directory
 * @returns Array of file/directory names
 *
 * @example
 * const files = await readdir('/path/to/dir');
 */
export async function readdir(p: string): Promise<string[]> {
  const fsp = getFsp();
  return fsp.readdir(p);
}

/**
 * Remove a file or directory recursively.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to remove
 * @param options - Optional recursive flag
 *
 * @example
 * await rm('/path/to/dir', { recursive: true });
 */
export async function rm(p: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
  const fsp = getFsp();
  await fsp.rm(p, options);
}

/**
 * Check if a directory is empty.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param dir - Path to directory
 * @returns true if directory is empty or doesn't exist
 *
 * @example
 * await isDirEmpty('/path/to/directory') // true or false
 */
export async function isDirEmpty(dir: string): Promise<boolean> {
  try {
    const fsp = getFsp();
    const items = await fsp.readdir(dir);
    return items.length === 0;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
    throw e;
  }
}

/**
 * Create a temporary directory with a unique name.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param prefix - Directory prefix
 * @returns Path to the created directory
 *
 * @example
 * const tmpDir = await mkdtemp('/tmp/myapp-');
 */
export async function mkdtemp(prefix: string): Promise<string> {
  const fsp = getFsp();
  return fsp.mkdtemp(prefix);
}

/**
 * Check if a file or directory is accessible.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param p - Path to check
 * @param mode - Access mode (default F_OK for existence check)
 * @throws Error if path is not accessible
 *
 * @example
 * await access('/path/to/file'); // throws if not accessible
 */
export async function access(p: string, mode?: number): Promise<void> {
  const fsp = getFsp();
  await fsp.access(p, mode ?? F_OK);
}

/**
 * Run a command as a child process.
 *
 * **Node.js only** - throws an error if called in browser.
 *
 * @param cmd - Command to run
 * @param args - Command arguments
 * @param opts - Options including cwd
 * @returns Promise that resolves when command completes successfully
 * @throws Error if command exits with non-zero code
 *
 * @example
 * await runCmd('npm', ['install'], { cwd: '/project' });
 */
export function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  const spawn = getSpawn();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    child.on('error', reject);
  });
}
