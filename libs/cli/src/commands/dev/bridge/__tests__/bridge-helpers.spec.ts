import { listChangedNotifications, mcpPathOf } from '../index';

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

describe('listChangedNotifications', () => {
  it('announces each list the restarted server says can change', () => {
    expect(
      listChangedNotifications({
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: true },
        },
      }),
    ).toEqual([
      { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
      { jsonrpc: '2.0', method: 'notifications/prompts/list_changed' },
    ]);
  });

  it('sends nothing without capabilities', () => {
    expect(listChangedNotifications(undefined)).toEqual([]);
    expect(listChangedNotifications({})).toEqual([]);
    expect(listChangedNotifications({ capabilities: 'x' })).toEqual([]);
  });
});
