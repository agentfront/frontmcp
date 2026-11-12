/**
 * Splits a server-sent event stream into the text of its complete events, accepting CRLF, CR and LF line
 * endings even when they are split across chunks. Each character is read once, however the stream is chunked.
 */
export class SseEventSplitter {
  private readonly pendingParts: string[] = [];
  private pendingEndsWithLineFeed = false;
  private carriageReturnHeld = false;

  /** Add the next decoded chunk and return the text of the events it completes. */
  push(chunk: string): string[] {
    let text = this.carriageReturnHeld ? `\r${chunk}` : chunk;
    this.carriageReturnHeld = text.endsWith('\r');
    if (this.carriageReturnHeld) text = text.slice(0, -1);
    text = text.replace(/\r\n?/g, '\n');

    const events: string[] = [];
    let start = 0;
    if (this.pendingEndsWithLineFeed && text.startsWith('\n')) {
      events.push(this.takePending().slice(0, -1));
      start = 1;
    }
    for (let end = text.indexOf('\n\n', start); end !== -1; end = text.indexOf('\n\n', start)) {
      events.push(this.takePending() + text.slice(start, end));
      start = end + 2;
    }
    const rest = text.slice(start);
    if (rest) {
      this.pendingParts.push(rest);
      this.pendingEndsWithLineFeed = rest.endsWith('\n');
    }
    return events;
  }

  /** The text received after the last complete event. */
  remainder(): string {
    return this.pendingParts.join('') + (this.carriageReturnHeld ? '\r' : '');
  }

  /** Return the incomplete event's text and start a new one. */
  private takePending(): string {
    const text = this.pendingParts.join('');
    this.pendingParts.length = 0;
    this.pendingEndsWithLineFeed = false;
    return text;
  }
}
