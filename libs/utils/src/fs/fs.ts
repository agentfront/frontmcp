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
    const fs = getFs();
    const fsp = getFsp();
    await fsp.access(p, fs.constants.F_OK);
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
