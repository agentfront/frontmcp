import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ParsedArgs } from '../../../core/args';
import { loadDevEnv } from '../../../shared/env';
import { resolveEntry } from '../../../shared/fs';
import { getRegisteredApp } from '../../package/registry';
import { runStart } from '../start';

const mockStart = jest.fn();
jest.mock('..', () => ({
  ProcessManager: jest.fn().mockImplementation(() => ({ start: mockStart })),
  formatProcessDetail: () => 'detail',
}));
jest.mock('../keep-alive', () => ({ superviseUntilSignalled: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../package/registry', () => ({ getRegisteredApp: jest.fn() }));
jest.mock('../../../shared/fs', () => ({ resolveEntry: jest.fn(async () => '/project/src/main.ts') }));
jest.mock('../../../shared/env', () => ({ loadDevEnv: jest.fn() }));
const mockShipEnv = jest.fn(async () => ({}) as Record<string, string>);
jest.mock('../ship-env', () => ({ loadShipEnv: (...args: unknown[]) => mockShipEnv(...(args as [])) }));

describe('runStart — installed apps (#642)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-start-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.clearAllMocks();
    mockStart.mockResolvedValue({ name: 'demo', pid: 1, port: 4100 });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const args = (extra: Partial<ParsedArgs> = {}): ParsedArgs => ({ _: ['start', 'demo'], ...extra }) as ParsedArgs;

  it('starts a registered app from its installed bundle and install dir', async () => {
    const bundle = path.join(dir, 'demo.bundle.js');
    fs.writeFileSync(bundle, '1;');
    (getRegisteredApp as jest.Mock).mockReturnValue({ installDir: dir, bundle, port: 4100 });

    await runStart(args());

    expect(resolveEntry).not.toHaveBeenCalled();
    expect(loadDevEnv).toHaveBeenCalledWith(dir);
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'demo', entry: bundle, port: 4100 }));
  });

  it('lets an explicit --port override the registered port', async () => {
    const bundle = path.join(dir, 'demo.bundle.js');
    fs.writeFileSync(bundle, '1;');
    (getRegisteredApp as jest.Mock).mockReturnValue({ installDir: dir, bundle, port: 4100 });

    await runStart(args({ port: 5000 }));

    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ port: 5000 }));
  });

  it('fails clearly when the installed bundle is gone', async () => {
    (getRegisteredApp as jest.Mock).mockReturnValue({ installDir: dir, bundle: path.join(dir, 'missing.js') });

    await expect(runStart(args())).rejects.toThrow(/missing its bundle/);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('prefers an explicit --entry over the registry', async () => {
    (getRegisteredApp as jest.Mock).mockReturnValue({ installDir: dir, bundle: path.join(dir, 'x.js') });

    await runStart(args({ entry: './src/main.ts' }));

    expect(getRegisteredApp).not.toHaveBeenCalled();
    expect(resolveEntry).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ entry: '/project/src/main.ts' }));
  });

  it('falls back to the project entry for unregistered names', async () => {
    (getRegisteredApp as jest.Mock).mockReturnValue(null);

    await runStart(args());

    expect(resolveEntry).toHaveBeenCalledWith(process.cwd(), undefined);
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({ entry: '/project/src/main.ts' }));
  });
});

describe('runStart — frontmcp.config env.shared / env.ship (#680)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.clearAllMocks();
    mockStart.mockResolvedValue({ name: 'demo', pid: 1, port: 4100 });
    (getRegisteredApp as jest.Mock).mockReturnValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env['SHIP_WINS_TEST'];
  });

  it('starts the server with the ship overlay under the real environment', async () => {
    process.env['SHIP_WINS_TEST'] = 'real';
    mockShipEnv.mockResolvedValue({ FROM_SHIP: 'ship', SHIP_WINS_TEST: 'ship' });

    await runStart({ _: ['start', 'demo'], entry: './src/main.ts' } as ParsedArgs);

    expect(mockShipEnv).toHaveBeenCalledWith('/project/src/main.ts', 'pm:start', undefined);
    const env = (mockStart.mock.calls[0][0] as { env: Record<string, string> }).env;
    expect(env['FROM_SHIP']).toBe('ship');
    expect(env['SHIP_WINS_TEST']).toBe('real');
  });
});

