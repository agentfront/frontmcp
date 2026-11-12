/** Counts the characters `indexOf('\n')` looks through in strings that start with `prefix`, until `stop()`. */
export function countNewlineSearch(prefix: string): { characters: () => number; stop: () => void } {
  const realIndexOf = String.prototype.indexOf;
  let characters = 0;
  const spy = jest.spyOn(String.prototype, 'indexOf').mockImplementation(function (
    this: string,
    search: string,
    position?: number,
  ) {
    if (search === '\n' && this.startsWith(prefix)) characters += this.length - (position ?? 0);
    return realIndexOf.call(this, search, position);
  });
  return { characters: () => characters, stop: () => spy.mockRestore() };
}
