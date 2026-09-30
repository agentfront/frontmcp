/** @jest-environment node */
import { create } from '@frontmcp/sdk';

import { setLocation, setNavigate } from '../router-bridge';
import { createRouterEntries } from '../router.entries';

describe('createRouterEntries', () => {
  it('returns two tools and one resource', () => {
    const { tools, resources } = createRouterEntries();
    expect(tools).toHaveLength(2);
    expect(resources).toHaveLength(1);
  });

  it('returns a new object on each call', () => {
    const a = createRouterEntries();
    const b = createRouterEntries();
    expect(a).not.toBe(b);
    expect(a.tools).not.toBe(b.tools);
  });

  it('entries are accepted by create() and work end to end', async () => {
    const navigate = jest.fn();
    setNavigate(navigate);
    setLocation({ pathname: '/a', search: '?q=1', hash: '#h' } as never);
    const { tools, resources } = createRouterEntries();
    const server = await create({ info: { name: 'router-entries', version: '1.0.0' }, tools, resources });
    try {
      const listed = await server.listTools();
      expect(listed.tools.map((t) => t.name).sort()).toEqual(['go_back', 'navigate']);

      await server.callTool('navigate', { path: '/next', replace: true });
      expect(navigate).toHaveBeenCalledWith('/next', { replace: true });

      await server.callTool('go_back', {});
      expect(navigate).toHaveBeenCalledWith(-1);

      const res = await server.readResource('route://current');
      const text = (res.contents[0] as { text: string }).text;
      expect(JSON.parse(text).href).toBe('/a?q=1#h');
    } finally {
      await server.dispose();
    }
  });
});
