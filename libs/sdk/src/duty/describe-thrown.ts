/** The message of a thrown value: an Error's own, else its string form, or its type tag when it has none. */
export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.message;
  try {
    return String(thrown);
  } catch {
    return Object.prototype.toString.call(thrown);
  }
}
