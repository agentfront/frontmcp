import { DEFAULT_BODY_LIMIT_BYTES, mcpTransportBodyLimit, parseByteLimit } from '../body-limit';

describe('parseByteLimit', () => {
  it.each([
    ['512kb', 512 * 1024],
    ['8MB', 8 * 1024 * 1024],
    [' 1gb ', 1024 ** 3],
    ['1.5kb', 1536],
    ['100', 100],
    ['100b', 100],
  ])('parses %j as %d bytes', (limit, bytes) => {
    expect(parseByteLimit(limit)).toBe(bytes);
  });

  it('takes a byte count as it is', () => {
    expect(parseByteLimit(2048)).toBe(2048);
    expect(parseByteLimit(0)).toBe(0);
  });

  it.each([[undefined], ['lots'], ['-1mb'], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'falls back to the 4 MiB default for %p',
    (limit) => {
      expect(parseByteLimit(limit)).toBe(DEFAULT_BODY_LIMIT_BYTES);
      expect(DEFAULT_BODY_LIMIT_BYTES).toBe(4 * 1024 * 1024);
    },
  );
});

describe('mcpTransportBodyLimit', () => {
  it('gives the MCP transport the configured limit, above its own 4 MiB default too', () => {
    expect(mcpTransportBodyLimit('8mb')).toBe(8 * 1024 * 1024);
    expect(mcpTransportBodyLimit('1kb')).toBe(1024);
    expect(mcpTransportBodyLimit(undefined)).toBe(DEFAULT_BODY_LIMIT_BYTES);
  });

  it('gives a positive bound for a limit of 0, which the transport requires', () => {
    expect(mcpTransportBodyLimit(0)).toBe(1);
    expect(mcpTransportBodyLimit('0kb')).toBe(1);
  });
});
