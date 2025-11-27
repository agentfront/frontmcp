/**
 * Size validation checks for the pre-scanner.
 * Validates input size, line count, and line length.
 *
 * @module pre-scanner/checks/size-check
 */

import type { PreScannerConfig } from '../config';
import type { ScanState } from '../scan-state';
import { PRESCANNER_ERROR_CODES } from '../errors';

/**
 * Check input size against limits.
 * This is the first check and should be very fast.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkInputSize(source: string, config: PreScannerConfig, state: ScanState): void {
  const inputSize = Buffer.byteLength(source, 'utf8');
  state.setInputSize(inputSize);

  if (inputSize > config.maxInputSize) {
    state.reportFatalError({
      code: PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE,
      message: `Input size (${formatBytes(inputSize)}) exceeds maximum allowed (${formatBytes(config.maxInputSize)})`,
      data: { actual: inputSize, limit: config.maxInputSize },
    });
  }
}

/**
 * Check for null bytes in input (binary data or attack indicator).
 * Null bytes are ALWAYS blocked regardless of configuration.
 *
 * @param source - The source code to check
 * @param state - Scan state for recording issues
 */
export function checkNullBytes(source: string, state: ScanState): void {
  const nullIndex = source.indexOf('\0');
  if (nullIndex !== -1) {
    state.reportFatalError({
      code: PRESCANNER_ERROR_CODES.NULL_BYTE_DETECTED,
      message: `Null byte (\\x00) detected at position ${nullIndex}. This may indicate binary data or an attack.`,
      position: nullIndex,
    });
  }
}

/**
 * Check line count and line lengths.
 * Iterates through lines once and validates both counts.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function checkLines(source: string, config: PreScannerConfig, state: ScanState): void {
  let lineCount = 0;
  let lineStart = 0;
  let position = 0;

  while (position <= source.length) {
    const char = source[position];

    // Check for line ending or end of string
    const isLineEnd = char === '\n' || char === '\r' || position === source.length;

    if (isLineEnd) {
      lineCount++;
      const lineLength = position - lineStart;

      // Track max line length
      state.updateMaxLineLength(lineLength);

      // Check line length
      if (lineLength > config.maxLineLength) {
        state.reportFatalError({
          code: PRESCANNER_ERROR_CODES.LINE_TOO_LONG,
          message: `Line ${lineCount} length (${lineLength}) exceeds maximum allowed (${config.maxLineLength})`,
          line: lineCount,
          position: lineStart,
          data: { actual: lineLength, limit: config.maxLineLength },
        });
        return; // Stop on first error
      }

      // Handle \r\n as single line ending
      if (char === '\r' && source[position + 1] === '\n') {
        position++;
      }

      lineStart = position + 1;

      // Check line count early to avoid scanning huge files
      if (lineCount > config.maxLines) {
        state.reportFatalError({
          code: PRESCANNER_ERROR_CODES.TOO_MANY_LINES,
          message: `File has more than ${config.maxLines} lines`,
          data: { actual: lineCount, limit: config.maxLines },
        });
        return;
      }
    }

    position++;
  }

  state.setLineCount(lineCount);
}

/**
 * Perform all size-related checks in sequence.
 * Stops early if any check fails.
 *
 * @param source - The source code to check
 * @param config - Pre-scanner configuration
 * @param state - Scan state for recording issues
 */
export function performSizeChecks(source: string, config: PreScannerConfig, state: ScanState): void {
  // 1. Check input size first (fastest check)
  checkInputSize(source, config, state);
  if (state.shouldStop()) return;

  // 2. Check for null bytes (security check)
  checkNullBytes(source, state);
  if (state.shouldStop()) return;

  // 3. Check lines (count and length)
  checkLines(source, config, state);
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
