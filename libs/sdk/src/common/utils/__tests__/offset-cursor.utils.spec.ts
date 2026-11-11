import { InvalidInputError } from '../../../errors';
import { encodeOffsetCursor, parseOffsetCursor } from '../offset-cursor.utils';

function cursorOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

describe('offset cursors', () => {
  it('encodes an offset as base64 JSON', () => {
    expect(encodeOffsetCursor(40)).toBe(cursorOf({ offset: 40 }));
    expect(encodeOffsetCursor(0)).toBe(cursorOf({ offset: 0 }));
  });

  it('reads back the offset it encoded', () => {
    expect(parseOffsetCursor(encodeOffsetCursor(0))).toBe(0);
    expect(parseOffsetCursor(encodeOffsetCursor(120))).toBe(120);
  });

  it('encodes and reads without Node Buffer, as in a browser', () => {
    const globals = globalThis as { Buffer?: typeof Buffer };
    const nodeBuffer = globals.Buffer;
    delete globals.Buffer;
    let cursor: string;
    let offset: number;
    try {
      cursor = encodeOffsetCursor(80);
      offset = parseOffsetCursor(cursor);
    } finally {
      globals.Buffer = nodeBuffer;
    }

    expect(cursor).toBe(cursorOf({ offset: 80 }));
    expect(offset).toBe(80);
  });

  it('refuses a cursor that is not base64 JSON', () => {
    expect(() => parseOffsetCursor('not a cursor')).toThrow(InvalidInputError);
    expect(() => parseOffsetCursor('not a cursor')).toThrow(
      "Invalid pagination cursor format. Expected base64-encoded JSON with 'offset' field.",
    );
  });

  it.each([
    ['a negative offset', { offset: -1 }, '-1'],
    ['a fractional offset', { offset: 1.5 }, '1.5'],
    ['an offset that is not a number', { offset: '40' }, 'string'],
    ['JSON without an offset', {}, 'undefined'],
    ['JSON null', null, 'undefined'],
  ])('refuses %s', (_label, value, received) => {
    expect(() => parseOffsetCursor(cursorOf(value))).toThrow(InvalidInputError);
    expect(() => parseOffsetCursor(cursorOf(value))).toThrow(
      `Invalid pagination cursor: offset must be a non-negative integer, got ${received}`,
    );
  });
});
