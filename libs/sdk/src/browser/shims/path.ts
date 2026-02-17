/**
 * Browser shim for node:path
 *
 * Minimal string-based path utilities for browser environments.
 */

export function join(...segments: string[]): string {
  return segments.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export function basename(p: string, ext?: string): string {
  const base = p.split('/').pop() ?? p;
  if (ext && base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}

export function dirname(p: string): string {
  const parts = p.split('/');
  parts.pop();
  return parts.join('/') || '.';
}

export function extname(p: string): string {
  const base = basename(p);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(dotIndex) : '';
}

export function resolve(...segments: string[]): string {
  return join(...segments);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/');
}

export const sep = '/';
export const delimiter = ':';

export const posix = { join, basename, dirname, extname, resolve, isAbsolute, sep, delimiter };

export default { join, basename, dirname, extname, resolve, isAbsolute, sep, delimiter, posix };
