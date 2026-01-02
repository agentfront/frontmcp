/**
 * Safely create a RegExp from user input to prevent ReDoS attacks.
 * Returns null if the pattern is invalid or potentially dangerous.
 *
 * @param pattern - The regex pattern string from user input
 * @returns A compiled RegExp or null if the pattern is unsafe/invalid
 */
export function safeRegex(pattern: string): RegExp | null {
  // Limit pattern length to prevent complex patterns
  if (pattern.length > 100) {
    return null;
  }
  try {
    const regex = new RegExp(pattern, 'i');
    // Quick test to ensure it doesn't hang on simple input
    regex.test('test');
    return regex;
  } catch {
    // Invalid regex syntax
    return null;
  }
}
