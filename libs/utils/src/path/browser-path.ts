function notAvailable(name: string): never {
  throw new Error(`path.${name}() is not available in browser environments`);
}

export function resolve(..._segments: string[]): string {
  return notAvailable('resolve');
}

export function join(..._segments: string[]): string {
  return notAvailable('join');
}

export function basename(p: string, ext?: string): string {
  // Strip trailing separators to match Node behavior (e.g. "foo/bar/" → "bar")
  const trimmed = p.replace(/[/\\]+$/, '');
  const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  let base = lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed;
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, -ext.length);
  }
  return base;
}

export function dirname(_p: string): string {
  return notAvailable('dirname');
}

export function extname(p: string): string {
  const base = basename(p);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex > 0 ? base.slice(dotIndex) : '';
}
