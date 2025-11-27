/**
 * String literal validation for the pre-scanner.
 * Checks string lengths and total string content.
 *
 * @module pre-scanner/checks/string-check
 */

import type { PreScannerConfig } from '../config';
import type { ScanState } from '../scan-state';
import { PRESCANNER_ERROR_CODES } from '../errors';

/**
 * Check string literals for excessive length.
 * This is a heuristic scan that finds string literals and validates their sizes.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkStringLiterals(source: string, config: PreScannerConfig, state: ScanState): void {
  let totalStringContent = 0;
  let position = 0;
  let line = 1;

  while (position < source.length) {
    const char = source[position];

    // Track lines
    if (char === '\n') {
      line++;
      position++;
      continue;
    }

    // Check for string start
    if (char === '"' || char === "'" || char === '`') {
      const stringStart = position;
      const stringLine = line;
      const quote = char;
      const isTemplate = char === '`';

      position++; // Move past opening quote

      let stringContent = '';
      let escaped = false;
      let templateDepth = 0;

      while (position < source.length) {
        const c = source[position];

        // Track lines in strings
        if (c === '\n') {
          line++;
        }

        if (escaped) {
          stringContent += c;
          escaped = false;
          position++;
          continue;
        }

        if (c === '\\') {
          escaped = true;
          position++;
          continue;
        }

        // Handle template string interpolation
        if (isTemplate && c === '$' && source[position + 1] === '{') {
          templateDepth++;
          position += 2;
          // Skip interpolation content
          while (position < source.length && templateDepth > 0) {
            const ic = source[position];
            if (ic === '\n') line++;
            if (ic === '{') templateDepth++;
            if (ic === '}') templateDepth--;
            position++;
          }
          continue;
        }

        if (c === quote && !isTemplate) {
          // End of regular string
          break;
        }

        if (c === '`' && isTemplate && templateDepth === 0) {
          // End of template string
          break;
        }

        stringContent += c;
        position++;
      }

      position++; // Move past closing quote

      const stringLength = stringContent.length;
      totalStringContent += stringLength;
      state.addStringContent(stringLength);

      // Check individual string length
      if (stringLength > config.maxStringLength) {
        state.reportFatalError({
          code: PRESCANNER_ERROR_CODES.STRING_TOO_LONG,
          message: `String literal length (${formatSize(stringLength)}) exceeds maximum allowed (${formatSize(
            config.maxStringLength,
          )})`,
          position: stringStart,
          line: stringLine,
          data: { actual: stringLength, limit: config.maxStringLength },
        });
        return;
      }

      // Check total string content
      if (totalStringContent > config.maxTotalStringContent) {
        state.reportFatalError({
          code: PRESCANNER_ERROR_CODES.STRING_TOTAL_EXCEEDED,
          message: `Total string content (${formatSize(totalStringContent)}) exceeds maximum allowed (${formatSize(
            config.maxTotalStringContent,
          )})`,
          position: stringStart,
          line: stringLine,
          data: { actual: totalStringContent, limit: config.maxTotalStringContent },
        });
        return;
      }

      continue;
    }

    // Skip comments
    if (char === '/') {
      const nextChar = source[position + 1];

      if (nextChar === '/') {
        // Line comment
        while (position < source.length && source[position] !== '\n') {
          position++;
        }
        continue;
      }

      if (nextChar === '*') {
        // Block comment
        position += 2;
        while (position < source.length - 1) {
          if (source[position] === '\n') line++;
          if (source[position] === '*' && source[position + 1] === '/') {
            position += 2;
            break;
          }
          position++;
        }
        continue;
      }
    }

    position++;
  }
}

/**
 * Perform string checks.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function performStringChecks(source: string, config: PreScannerConfig, state: ScanState): void {
  checkStringLiterals(source, config, state);
}

/**
 * Format size as human-readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} chars`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
