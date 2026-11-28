/**
 * How the sandbox's error for a `parallel()` whose callbacks failed starts, on either runtime:
 * `2 of 5 parallel operations failed:` and a line per failure, its message (after `[index]: ` on some builds).
 */
const PARALLEL_FAILED_RE = /^(\d+) of (\d+) parallel operations failed:\n/;

/** The index some builds put before each listed message. */
const LISTED_INDEX_RE = /^\[\d+\]: /;

/**
 * Whether a message is one of the failures a failed `parallel()`'s error lists, for that error's message; undefined
 * for any other error. A failure is listed when an entry starts a line with its whole message, up to the next line or
 * the end. The sandbox cuts the last entry at its size limit without marking it, so a cut message is not listed.
 */
export function parallelFailuresOf(message: string | undefined): ((failure: string) => boolean) | undefined {
  const match = message ? PARALLEL_FAILED_RE.exec(message) : null;
  if (!message || !match) return undefined;
  const list = message.slice(match[0].length);
  const entryStarts = [0];
  for (let index = list.indexOf('\n'); index !== -1; index = list.indexOf('\n', index + 1)) entryStarts.push(index + 1);
  const entries = entryStarts.flatMap((start) => {
    const indexed = LISTED_INDEX_RE.exec(list.slice(start, start + 24));
    return indexed ? [start, start + indexed[0].length] : [start];
  });
  return (failure) => {
    if (!failure) return false;
    return entries.some((start) => {
      const end = start + failure.length;
      return list.startsWith(failure, start) && (end === list.length || list[end] === '\n');
    });
  };
}
