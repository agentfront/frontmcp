// file: libs/sdk/src/tool/undeclared-arguments-message.ts
import { formatKeyPath, type ArgumentKeyPath } from './undeclared-arguments';

/** The `INVALID_INPUT` message of a call refused under `input.undeclaredKeys: 'fail'`. */
export function undeclaredArgumentsRefusal(
  keyPaths: readonly ArgumentKeyPath[],
  declaredKeys: readonly string[],
): string {
  return `Unknown arguments: ${describeUndeclaredArguments(keyPaths, declaredKeys)}`;
}

/** The last text line of an answer under `input.undeclaredKeys: 'warn'`, for the model that called. */
export function undeclaredArgumentsNote(keyPaths: readonly ArgumentKeyPath[], declaredKeys: readonly string[]): string {
  return `These arguments are not declared and were ignored: ${describeUndeclaredArguments(keyPaths, declaredKeys)}.`;
}

/** The server warning under `input.undeclaredKeys: 'warn'`, naming the key paths not reported for the tool before. */
export function undeclaredArgumentsWarning(toolName: string, newKeyPaths: readonly string[]): string {
  return (
    `Tool "${toolName}" was called with arguments its inputSchema does not declare, so they were ignored: ` +
    `${namedWithTheRestCounted(newKeyPaths.map(shortened))}. Declare them, or set input.undeclaredKeys to 'strip' or 'fail'.`
  );
}

/** How many undeclared arguments a message names; the rest are counted. */
const MAX_NAMED_ARGUMENTS = 20;

/** How long a key a message shows whole, and the longest key the closest-key search compares. */
const MAX_KEY_LENGTH = 64;

/** How many declared keys the closest-key search compares a key with. */
const MAX_COMPARED_KEYS = 200;

/**
 * Each undeclared argument, quoted, with the declared key it is closest to when one is close enough to be a slip: the
 * first {@link MAX_NAMED_ARGUMENTS}, each cut to {@link MAX_KEY_LENGTH} characters, then how many more there are.
 */
export function describeUndeclaredArguments(
  keyPaths: readonly ArgumentKeyPath[],
  declaredKeys: readonly string[],
): string {
  const described = keyPaths.slice(0, MAX_NAMED_ARGUMENTS).map((keyPath) => {
    const shown = shortened(formatKeyPath(keyPath));
    const closest = keyPath.length === 1 ? closestKey(keyPath[0], declaredKeys) : undefined;
    return closest ? `'${shown}' (did you mean '${closest}'?)` : `'${shown}'`;
  });
  return namedWithTheRestCounted(described, keyPaths.length);
}

/** The first {@link MAX_NAMED_ARGUMENTS} of `names`, then how many more of `total` there are. */
function namedWithTheRestCounted(names: readonly string[], total = names.length): string {
  const named = names.slice(0, MAX_NAMED_ARGUMENTS);
  const unnamed = total - named.length;
  return unnamed > 0 ? `${named.join(', ')} and ${unnamed} more` : named.join(', ');
}

function shortened(text: string): string {
  return text.length > MAX_KEY_LENGTH ? `${text.slice(0, MAX_KEY_LENGTH)}…` : text;
}

function closestKey(key: string, declaredKeys: readonly string[]): string | undefined {
  if (key.length > MAX_KEY_LENGTH) return undefined;
  const candidates = declaredKeys.slice(0, MAX_COMPARED_KEYS).filter((candidate) => candidate.length <= MAX_KEY_LENGTH);
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
