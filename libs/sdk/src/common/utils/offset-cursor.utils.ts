import { base64Decode, base64Encode } from '@frontmcp/utils';

import { InvalidInputError } from '../../errors/mcp.error';

/** The opaque cursor of the list page that starts at `offset`: base64 JSON, built without Node's Buffer for browsers. */
export function encodeOffsetCursor(offset: number): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify({ offset })));
}

/** The offset a list cursor names; throws `InvalidInputError` for a cursor that is not one `encodeOffsetCursor` made. */
export function parseOffsetCursor(cursor: string): number {
  let offset: unknown;
  try {
    offset = JSON.parse(new TextDecoder().decode(base64Decode(cursor)))?.offset;
  } catch {
    throw new InvalidInputError(`Invalid pagination cursor format. Expected base64-encoded JSON with 'offset' field.`);
  }
  if (typeof offset !== 'number' || offset < 0 || !Number.isInteger(offset)) {
    const received = typeof offset === 'number' ? offset : typeof offset;
    throw new InvalidInputError(`Invalid pagination cursor: offset must be a non-negative integer, got ${received}`);
  }
  return offset;
}
