import { affinityCookieOptions, applyMachineIdHeader, applyNodeAffinity, machineIdHeader } from '../ha-headers';

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

  it('describes the header for adapters that build their own responses', () => {
    expect(machineIdHeader()).toEqual(['X-FrontMCP-Machine-Id', 'node-1']);
    mockRuntime.deployment = 'standalone';
    expect(machineIdHeader()).toBeUndefined();
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

  describe('server.cookies from frontmcp.config (FRONTMCP_AFFINITY_COOKIE*)', () => {
    const keys = ['FRONTMCP_AFFINITY_COOKIE', 'FRONTMCP_AFFINITY_COOKIE_DOMAIN', 'FRONTMCP_AFFINITY_COOKIE_SAMESITE'];
    afterEach(() => {
      for (const key of keys) delete process.env[key];
    });

    it('defaults to __frontmcp_node with no domain or SameSite override', () => {
      expect(affinityCookieOptions()).toEqual({ name: '__frontmcp_node' });
    });

    it('uses the configured name, domain and SameSite on the Set-Cookie', () => {
      process.env['FRONTMCP_AFFINITY_COOKIE'] = 'pod';
      process.env['FRONTMCP_AFFINITY_COOKIE_DOMAIN'] = 'example.com';
      process.env['FRONTMCP_AFFINITY_COOKIE_SAMESITE'] = 'lax';
      const res = makeResponse();
      applyNodeAffinity(res, { headers: { host: 'api.example.com' }, url: '/mcp' } as never);
      const [cookie] = res.headers.get('Set-Cookie') as string[];
      expect(cookie).toMatch(/^pod=node-1;/);
      expect(cookie).toContain('Domain=example.com');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('ignores an unknown SameSite value', () => {
      process.env['FRONTMCP_AFFINITY_COOKIE_SAMESITE'] = 'sometimes';
      expect(affinityCookieOptions()).toEqual({ name: '__frontmcp_node' });
    });
  });
});
