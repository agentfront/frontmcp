import { applyMachineIdHeader, applyNodeAffinity } from '../ha-headers';

const mockRuntime = { deployment: 'distributed' };
jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  getRuntimeContext: () => mockRuntime,
  getMachineId: () => 'node-1',
}));

function makeResponse() {
  const headers = new Map<string, string | string[]>();
  return {
    headers,
    setHeader: (n: string, v: string | string[]) => void headers.set(n, v),
    getHeader: (n: string) => headers.get(n),
  };
}

describe('ha-headers', () => {
  afterEach(() => {
    mockRuntime.deployment = 'distributed';
  });

  it('sets X-FrontMCP-Machine-Id in distributed mode', () => {
    const res = makeResponse();
    expect(applyMachineIdHeader(res)).toBe(true);
    expect(res.headers.get('X-FrontMCP-Machine-Id')).toBe('node-1');
  });

  it('does nothing outside distributed mode', () => {
    mockRuntime.deployment = 'standalone';
    const res = makeResponse();
    expect(applyMachineIdHeader(res)).toBe(false);
    applyNodeAffinity(res, { headers: {} } as never);
    expect(res.headers.size).toBe(0);
  });

  it('adds the affinity cookie and keeps an existing Set-Cookie', () => {
    const res = makeResponse();
    res.setHeader('Set-Cookie', 'a=b');
    applyNodeAffinity(res, { headers: { host: 'localhost' }, url: '/mcp' } as never);
    expect(res.headers.get('X-FrontMCP-Machine-Id')).toBe('node-1');
    const cookies = res.headers.get('Set-Cookie') as string[];
    expect(cookies[0]).toBe('a=b');
    expect(cookies.length).toBeGreaterThanOrEqual(1);
  });
});
