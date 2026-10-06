import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { formatProcessDetail, formatProcessTable } from '../format';
import { ProcessManager } from '../manager';
import { listPidFiles, readPidFile } from '../pidfile';

jest.mock('os', () => {
  const actualOs = jest.requireActual('os');
  const actualFs = jest.requireActual('fs');
  const actualPath = jest.requireActual('path');
  const temporaryHome = actualFs.mkdtempSync(actualPath.join(actualOs.tmpdir(), 'frontmcp-pm-'));
  return { ...actualOs, homedir: () => temporaryHome };
});

describe('pm pid files written by a compiled CLI daemon (#768)', () => {
  const temporaryHome = os.homedir();
  const pidsDir = path.join(temporaryHome, '.frontmcp', 'pids');
  const daemonPidData = { pid: 999999, startedAt: '2026-10-06T10:00:00.000Z', socketPath: '/tmp/demo.sock' };
  const invalidPids = { zero: 0, negative: -1, fractional: 1.5 };

  beforeAll(() => {
    fs.mkdirSync(pidsDir, { recursive: true });
    fs.writeFileSync(path.join(pidsDir, 'demo.pid'), JSON.stringify(daemonPidData));
    fs.writeFileSync(path.join(pidsDir, 'broken.pid'), JSON.stringify({ name: 'broken' }));
    for (const [name, pid] of Object.entries(invalidPids)) {
      fs.writeFileSync(path.join(pidsDir, `${name}.pid`), JSON.stringify({ pid }));
    }
  });

  afterAll(() => {
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  });

  it('fills in the name and defaults that the daemon does not write', () => {
    expect(readPidFile('demo')).toEqual({
      ...daemonPidData,
      name: 'demo',
      entry: '',
      restartCount: 0,
      supervisorPid: 999999,
      cliVersion: '',
    });
  });

  it('skips a pid file without a numeric pid', () => {
    expect(readPidFile('broken')).toBeNull();
    expect(listPidFiles().map((data) => data.name)).toEqual(['demo']);
  });

  it.each(Object.keys(invalidPids))('skips a pid file whose pid is not a positive integer (%s)', (name) => {
    expect(readPidFile(name)).toBeNull();
    expect(listPidFiles().map((data) => data.name)).not.toContain(name);
  });

  it('lists and shows the daemon without crashing', () => {
    const processManager = new ProcessManager();
    expect(formatProcessTable(processManager.listAll())).toContain('demo');
    const info = processManager.getProcessInfo('demo');
    expect(info).not.toBeNull();
    if (info) expect(formatProcessDetail(info)).toContain('demo');
  });
});
