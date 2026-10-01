/**
 * `resolveDevLaunch` — the launch plan `frontmcp dev` and `frontmcp dev --stdio`
 * share (#679).
 *
 * - From a subfolder, `frontmcp.config.*` was found in the parent but `entry`
 *   resolved from the cwd: `Entry override not found: ./src/main.ts`.
 * - The stdio bridge ignored config, `.env` and `PORT` entirely.
 */
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { mkdir, mkdtemp, realpath, rm, writeFile } from '@frontmcp/utils';

import { resolveDevLaunch } from '../dev';

describe('resolveDevLaunch', () => {
  let root: string;
  let sub: string;
  let cwdSpy: jest.SpyInstance;
  let chdirSpy: jest.SpyInstance;
  const savedPort = process.env['PORT'];

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'frontmcp-dev-launch-')));
    sub = path.join(root, 'src');
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(sub, 'main.ts'), 'export {};\n');
    await writeFile(path.join(sub, 'other.ts'), 'export {};\n');
    await writeFile(
      path.join(root, 'frontmcp.config.json'),
      JSON.stringify({
        name: 'launch-demo',
        entry: './src/main.ts',
        deployments: [{ target: 'node' }],
        transport: { http: { path: '/mcp' } },
        env: { dev: { FROM_CONFIG: 'yes' } },
      }),
    );
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(sub);
    chdirSpy = jest.spyOn(process, 'chdir').mockImplementation(() => undefined);
    delete process.env['PORT'];
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    chdirSpy.mockRestore();
    if (savedPort === undefined) delete process.env['PORT'];
    else process.env['PORT'] = savedPort;
    await rm(root, { recursive: true, force: true });
  });

  it('runs from the folder holding a config found above the cwd', async () => {
    const launch = await resolveDevLaunch({ _: [], port: 4310 } as never);

    expect(chdirSpy).toHaveBeenCalledWith(root);
    expect(launch.cwd).toBe(root);
    expect(launch.movedFrom).toBe(sub);
    expect(launch.entry).toBe(path.join(root, 'src', 'main.ts'));
  });

  it('resolves an --entry typed in the subfolder from the subfolder', async () => {
    const launch = await resolveDevLaunch({ _: [], port: 4310, entry: 'other.ts' } as never);

    expect(launch.entry).toBe(path.join(sub, 'other.ts'));
  });

  it('hands the child the port, the configured MCP path and the env overlays', async () => {
    const launch = await resolveDevLaunch({ _: [], port: 4311 } as never);

    expect(launch.port).toBe(4311);
    expect(launch.configHttpPath).toBe('/mcp');
    expect(launch.childEnv['PORT']).toBe('4311');
    expect(launch.childEnv['FRONTMCP_HTTP_ENTRY_PATH']).toBe('/mcp');
    expect(launch.childEnv['FROM_CONFIG']).toBe('yes');
  });

  it('does not probe the port when nothing will listen on it (--stdio --serve)', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const busy = (server.address() as net.AddressInfo).port;
    try {
      const launch = await resolveDevLaunch({ _: [], port: busy } as never, { listens: false });
      expect(launch.port).toBe(busy);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('with autoPortWhenUnset, picks a free port instead of failing on a busy default', async () => {
    const log = jest.fn();
    const launch = await resolveDevLaunch({ _: [] } as never, { autoPortWhenUnset: true, log });

    expect(launch.port).toBeGreaterThanOrEqual(3000);
    expect(launch.childEnv['PORT']).toBe(String(launch.port));
  });
});
