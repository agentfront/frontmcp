// file: libs/sdk/src/tool/undeclared-arguments-message.ts
import { topLevelKeyOf } from './undeclared-arguments';

/** The `INVALID_INPUT` message of a call refused under `input.undeclaredKeys: 'fail'`. */
export function undeclaredArgumentsRefusal(keyPaths: readonly string[], declaredKeys: readonly string[]): string {
  return `Unknown arguments: ${describeUndeclaredArguments(keyPaths, declaredKeys)}`;
}

/** The last text line of an answer under `input.undeclaredKeys: 'warn'`, for the model that called. */
export function undeclaredArgumentsNote(keyPaths: readonly string[], declaredKeys: readonly string[]): string {
  return `These arguments are not declared and were ignored: ${describeUndeclaredArguments(keyPaths, declaredKeys)}.`;
}

/** The server warning under `input.undeclaredKeys: 'warn'`, naming the key paths not reported for the tool before. */
export function undeclaredArgumentsWarning(toolName: string, newKeyPaths: readonly string[]): string {
  return (
    `Tool "${toolName}" was called with arguments its inputSchema does not declare, so they were ignored: ` +
    `${newKeyPaths.join(', ')}. Declare them, or set input.undeclaredKeys to 'strip' or 'fail'.`
  );
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
