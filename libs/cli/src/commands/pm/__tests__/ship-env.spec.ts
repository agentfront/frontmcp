import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadShipEnv } from '../ship-env';

describe('loadShipEnv (#680)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-env-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function writeConfig(env: unknown): void {
    fs.writeFileSync(
      path.join(dir, 'frontmcp.config.json'),
      JSON.stringify({ name: 'demo', deployments: [{ target: 'node' }], env }),
    );
  }

  it('reads env.shared ⊕ env.ship from the config above the entry, ignoring the other overlays', async () => {
    writeConfig({ shared: { A: 'shared', B: 'shared' }, ship: { B: 'ship' }, dev: { C: 'dev' }, test: { D: 'test' } });
    fs.mkdirSync(path.join(dir, 'src'));
    const entry = path.join(dir, 'src', 'main.ts');
    expect(await loadShipEnv(entry, 'pm:start')).toEqual({ A: 'shared', B: 'ship' });
    expect(await loadShipEnv(entry, 'pm:socket')).toEqual({ A: 'shared', B: 'ship' });
  });

  it('honours an explicit config path', async () => {
    writeConfig({ ship: { FROM: 'explicit' } });
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-env-entry-'));
    try {
      expect(
        await loadShipEnv(path.join(elsewhere, 'main.ts'), 'pm:start', path.join(dir, 'frontmcp.config.json')),
      ).toEqual({ FROM: 'explicit' });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('is empty without a config', async () => {
    expect(await loadShipEnv(path.join(dir, 'main.ts'), 'pm:start')).toEqual({});
  });
});
