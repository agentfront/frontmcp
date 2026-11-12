/**
 * A filter for names that contain `text`, ignoring case, in time linear in the name's length. Plain text matches
 * what the case-insensitive regular expression of the same text matched; regular expression syntax is not
 * interpreted.
 */
export function containsText(text: string): (value: string) => boolean {
  const needle = text.toLowerCase();
  return (value) => value.toLowerCase().includes(needle);
}
