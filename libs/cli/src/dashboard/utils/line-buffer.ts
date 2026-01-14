/**
 * LineBuffer - Proper line buffering for streaming output
 *
 * Handles incomplete lines that may be split across multiple data chunks.
 * This prevents data loss when streaming output from child processes.
 */

export class LineBuffer {
  private buffer = '';

  /**
   * Push data into the buffer and return complete lines.
   *
   * @param data - The incoming data string
   * @returns Array of complete lines (without newline characters)
   */
  push(data: string): string[] {
    this.buffer += data;
    const lines: string[] = [];
    let idx: number;

    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      // Extract the line (without the newline)
      const line = this.buffer.slice(0, idx);
      // Remove the processed line and newline from buffer
      this.buffer = this.buffer.slice(idx + 1);
      // Only add non-empty lines
      if (line.length > 0 || lines.length > 0) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Flush any remaining content in the buffer.
   * Call this when the stream ends to get any final incomplete line.
   *
   * @returns The remaining content or null if buffer is empty
   */
  flush(): string | null {
    if (!this.buffer) return null;
    const remaining = this.buffer;
    this.buffer = '';
    return remaining;
  }

  /**
   * Check if there's any pending content in the buffer.
   */
  get hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Get the current buffer length.
   */
  get pendingLength(): number {
    return this.buffer.length;
  }

  /**
   * Clear the buffer without returning content.
   */
  clear(): void {
    this.buffer = '';
  }
}
