/**
 * Pre-built safe pattern utilities for common string operations.
 *
 * These utilities avoid vulnerable regex patterns like alternation with
 * greedy quantifiers (e.g., /^\/+|\/+$/g) that can cause ReDoS attacks.
 */

import { DEFAULT_MAX_INPUT_LENGTH } from './safe-regex';

/**
 * Remove leading occurrences of a character from a string.
 *
 * This is a safe alternative to patterns like /^X+/ that avoids
 * potential ReDoS issues with alternation patterns.
 *
 * @param input - String to trim
 * @param char - Single character to remove from the start
 * @returns String with leading characters removed
 *
 * @example
 * ```typescript
 * trimLeading('///path', '/'); // 'path'
 * trimLeading('---name', '-'); // 'name'
 * trimLeading('hello', 'x'); // 'hello'
 * ```
 */
export function trimLeading(input: string, char: string): string {
  if (!input || char.length !== 1) {
    return input ?? '';
  }

  let start = 0;
  while (start < input.length && input[start] === char) {
    start++;
  }

  return start === 0 ? input : input.slice(start);
}

/**
 * Remove trailing occurrences of a character from a string.
 *
 * This is a safe alternative to patterns like /X+$/ that avoids
 * potential ReDoS issues with alternation patterns.
 *
 * @param input - String to trim
 * @param char - Single character to remove from the end
 * @returns String with trailing characters removed
 *
 * @example
 * ```typescript
 * trimTrailing('path///', '/'); // 'path'
 * trimTrailing('name---', '-'); // 'name'
 * trimTrailing('hello', 'x'); // 'hello'
 * ```
 */
export function trimTrailing(input: string, char: string): string {
  if (!input || char.length !== 1) {
    return input ?? '';
  }

  let end = input.length;
  while (end > 0 && input[end - 1] === char) {
    end--;
  }

  return end === input.length ? input : input.slice(0, end);
}

/**
 * Remove both leading and trailing occurrences of a character from a string.
 *
 * This is a safe alternative to the vulnerable pattern /^X+|X+$/g
 * which uses alternation with greedy quantifiers and can cause ReDoS.
 *
 * @param input - String to trim
 * @param char - Single character to remove from both ends
 * @returns String with leading and trailing characters removed
 *
 * @example
 * ```typescript
 * trimBoth('///path///', '/'); // 'path'
 * trimBoth('---name---', '-'); // 'name'
 * trimBoth('/single/', '/'); // 'single'
 * ```
 */
export function trimBoth(input: string, char: string): string {
  return trimTrailing(trimLeading(input, char), char);
}

/**
 * Remove multiple leading/trailing characters from a string.
 *
 * @param input - String to trim
 * @param chars - Set of characters to remove from both ends
 * @returns String with specified characters removed from both ends
 *
 * @example
 * ```typescript
 * trimChars('  -name-  ', new Set([' ', '-'])); // 'name'
 * ```
 */
export function trimChars(input: string, chars: Set<string>): string {
  if (!input || chars.size === 0) {
    return input ?? '';
  }

  let start = 0;
  while (start < input.length && chars.has(input[start])) {
    start++;
  }

  let end = input.length;
  while (end > start && chars.has(input[end - 1])) {
    end--;
  }

  return input.slice(start, end);
}

/**
 * Extract parameters from a braced template string safely.
 *
 * Uses a non-backtracking approach to parse {param} patterns,
 * avoiding the vulnerable /\{([^}]+)\}/g pattern.
 *
 * @param template - Template string containing {param} placeholders
 * @param maxLength - Maximum template length to process (default: 50000)
 * @returns Array of parameter names found in the template
 *
 * @example
 * ```typescript
 * extractBracedParams('/users/{userId}/posts/{postId}');
 * // ['userId', 'postId']
 *
 * extractBracedParams('Hello {name}!');
 * // ['name']
 * ```
 */
export function extractBracedParams(template: string, maxLength: number = DEFAULT_MAX_INPUT_LENGTH): string[] {
  if (!template || template.length > maxLength) {
    return [];
  }

  const params: string[] = [];
  let i = 0;

  while (i < template.length) {
    // Find opening brace
    const openBrace = template.indexOf('{', i);
    if (openBrace === -1) {
      break;
    }

    // Find closing brace
    const closeBrace = template.indexOf('}', openBrace + 1);
    if (closeBrace === -1) {
      break;
    }

    // Check for nested braces (invalid, skip)
    const nestedOpen = template.indexOf('{', openBrace + 1);
    if (nestedOpen !== -1 && nestedOpen < closeBrace) {
      // Skip to after the nested open brace
      i = nestedOpen + 1;
      continue;
    }

    // Extract parameter name
    const paramName = template.slice(openBrace + 1, closeBrace).trim();
    if (paramName && !paramName.includes('{') && !paramName.includes('}')) {
      params.push(paramName);
    }

    i = closeBrace + 1;
  }

  return params;
}

/**
 * Expand a template string by replacing {param} placeholders with values.
 *
 * Uses a safe character-by-character approach instead of regex.
 *
 * @param template - Template string containing {param} placeholders
 * @param values - Object mapping parameter names to values
 * @param maxLength - Maximum template length to process (default: 50000)
 * @returns Expanded string with placeholders replaced
 *
 * @example
 * ```typescript
 * expandTemplate('/users/{userId}', { userId: '123' });
 * // '/users/123'
 *
 * expandTemplate('Hello {name}!', { name: 'World' });
 * // 'Hello World!'
 * ```
 */
export function expandTemplate(
  template: string,
  values: Record<string, string>,
  maxLength: number = DEFAULT_MAX_INPUT_LENGTH,
): string {
  if (!template || template.length > maxLength) {
    return template ?? '';
  }

  let result = '';
  let i = 0;

  while (i < template.length) {
    const openBrace = template.indexOf('{', i);

    if (openBrace === -1) {
      // No more placeholders
      result += template.slice(i);
      break;
    }

    // Add text before the brace
    result += template.slice(i, openBrace);

    const closeBrace = template.indexOf('}', openBrace + 1);

    if (closeBrace === -1) {
      // Unclosed brace, add rest of string
      result += template.slice(openBrace);
      break;
    }

    // Check for nested braces
    const nestedOpen = template.indexOf('{', openBrace + 1);
    if (nestedOpen !== -1 && nestedOpen < closeBrace) {
      // Nested brace - add the first brace and continue from there
      result += '{';
      i = openBrace + 1;
      continue;
    }

    const paramName = template.slice(openBrace + 1, closeBrace).trim();

    if (paramName in values) {
      result += values[paramName];
    } else {
      // Keep original placeholder if no value
      result += template.slice(openBrace, closeBrace + 1);
    }

    i = closeBrace + 1;
  }

  return result;
}

/**
 * Check if a string contains template placeholders.
 *
 * Uses a simple indexOf check instead of regex.
 *
 * @param str - String to check
 * @param maxLength - Maximum string length to check (default: 50000)
 * @returns true if string contains {param} style placeholders
 */
export function hasTemplatePlaceholders(str: string, maxLength: number = DEFAULT_MAX_INPUT_LENGTH): boolean {
  if (!str || str.length > maxLength) {
    return false;
  }

  const openBrace = str.indexOf('{');
  if (openBrace === -1) {
    return false;
  }

  const closeBrace = str.indexOf('}', openBrace + 1);
  return closeBrace > openBrace + 1;
}

/**
 * Collapse multiple consecutive characters into a single occurrence.
 *
 * Safe alternative to patterns like /X+/g which can be combined
 * with other patterns to create ReDoS vulnerabilities.
 *
 * @param input - String to process
 * @param char - Character to collapse
 * @returns String with consecutive characters collapsed
 *
 * @example
 * ```typescript
 * collapseChar('foo///bar', '/'); // 'foo/bar'
 * collapseChar('hello   world', ' '); // 'hello world'
 * ```
 */
export function collapseChar(input: string, char: string): string {
  if (!input || char.length !== 1) {
    return input ?? '';
  }

  let result = '';
  let lastWasChar = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === char) {
      if (!lastWasChar) {
        result += c;
        lastWasChar = true;
      }
      // Skip consecutive occurrences
    } else {
      result += c;
      lastWasChar = false;
    }
  }

  return result;
}

/**
 * Collapse all whitespace to single spaces.
 *
 * Safe alternative to /\s+/g which can be part of vulnerable patterns.
 *
 * @param input - String to process
 * @param maxLength - Maximum input length to process (default: 50000)
 * @returns String with whitespace collapsed to single spaces
 *
 * @example
 * ```typescript
 * collapseWhitespace('hello   world\n\nfoo'); // 'hello world foo'
 * ```
 */
export function collapseWhitespace(input: string, maxLength: number = DEFAULT_MAX_INPUT_LENGTH): string {
  if (!input) {
    return '';
  }

  if (input.length > maxLength) {
    return input;
  }

  let result = '';
  let lastWasWhitespace = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const isWhitespace = c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

    if (isWhitespace) {
      if (!lastWasWhitespace) {
        result += ' ';
        lastWasWhitespace = true;
      }
    } else {
      result += c;
      lastWasWhitespace = false;
    }
  }

  return result;
}
