import { mcpPathOf } from '../index';

describe('mcpPathOf', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/', '/'],
    ['mcp', '/mcp'],
    ['/mcp/', '/mcp'],
    ['/api/mcp', '/api/mcp'],
  ])('%p → %p', (input, expected) => {
    expect(mcpPathOf(input)).toBe(expected);
  });
});
