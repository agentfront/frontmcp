/**
 * How the sandbox's error for a `parallel()` whose callbacks failed starts, on either runtime:
 * `2 of 5 parallel operations failed:` and a line per failure, its message (after `[index]: ` on some builds).
 */
const PARALLEL_FAILED_RE = /^(\d+) of (\d+) parallel operations failed:\n/;

/** The shortest end of a cut message that counts as that message: the sandbox cuts the list at its size limit. */
const MIN_CUT_MESSAGE_CHARS = 24;

/**
 * Whether a message is one of the failures a failed `parallel()`'s error lists, for that error's message; undefined
 * for any other error. A listed message may be cut short where the list reaches the sandbox's size limit.
 */
export function parallelFailuresOf(message: string | undefined): ((failure: string) => boolean) | undefined {
  const match = message ? PARALLEL_FAILED_RE.exec(message) : null;
  if (!message || !match) return undefined;
  const list = message.slice(match[0].length);
  const lineStarts = [0];
  for (let index = list.indexOf('\n'); index !== -1; index = list.indexOf('\n', index + 1)) lineStarts.push(index + 1);
  return (failure) => {
    if (!failure) return false;
    if (list.includes(failure)) return true;
    // The last listed message, cut at the limit: the list ends with its start.
    return lineStarts.some((start) => {
      const tail = list.slice(start).replace(/^\[\d+\]: /, '');
      return tail.length >= MIN_CUT_MESSAGE_CHARS && tail.length < failure.length && failure.startsWith(tail);
    });
  };
}
