// file: libs/sdk/src/tool/undeclared-arguments.ts
import { hasTransform } from '@frontmcp/lazy-zod';
import { findDroppedKeys } from '@frontmcp/utils';

/** The argument key paths parsing dropped; below a field with a transform the shapes differ, so none are compared. */
export function findUndeclaredArguments(
  shape: Readonly<Record<string, unknown>>,
  sent: unknown,
  parsed: unknown,
): string[] {
  return findDroppedKeys(sent, parsed).filter((keyPath) => {
    const field = topLevelKeyOf(keyPath);
    return keyPath === field || !hasTransform(shape[field]);
  });
}

/** Each undeclared argument, quoted, with the declared key it is closest to when one is close enough to be a slip. */
export function describeUndeclaredArguments(keyPaths: readonly string[], declaredKeys: readonly string[]): string {
  return keyPaths
    .map((keyPath) => {
      const closest = keyPath === topLevelKeyOf(keyPath) ? closestKey(keyPath, declaredKeys) : undefined;
      return closest ? `'${keyPath}' (did you mean '${closest}'?)` : `'${keyPath}'`;
    })
    .join(', ');
}

function topLevelKeyOf(keyPath: string): string {
  return keyPath.split(/[.[]/, 1)[0];
}

function closestKey(key: string, candidates: readonly string[]): string | undefined {
  let closest: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (!closest || distance < closest.distance) closest = { candidate, distance };
  }
  if (!closest) return undefined;
  return closest.distance * 2 <= Math.max(key.length, closest.candidate.length) ? closest.candidate : undefined;
}

/** The Levenshtein distance: the fewest one-character insertions, deletions and substitutions from one to the other. */
function editDistance(source: string, target: string): number {
  const row = Array.from({ length: target.length + 1 }, (_, index) => index);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
    let diagonal = row[0];
    row[0] = sourceIndex;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex++) {
      const above = row[targetIndex];
      const substitution = diagonal + (source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1);
      row[targetIndex] = Math.min(above + 1, row[targetIndex - 1] + 1, substitution);
      diagonal = above;
    }
  }
  return row[target.length];
}
