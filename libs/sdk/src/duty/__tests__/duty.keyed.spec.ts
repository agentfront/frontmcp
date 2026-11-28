/**
 * Duty leases the app names, and a preferred holder (#1358). Processes whose `scope: { key }` is the same share one
 * lease, whatever folder they run from; `prefer` lets a designated process take the lease over. Each container here
 * stands for one process.
 */
import 'reflect-metadata';

import * as os from 'os';
import * as path from 'path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { Duty, LogLevel } from '../../common';
import { DutyLeaseKeyError } from '../../errors';
import { createContainer, type FrontMcpContainer } from '../../provider/create-container';
import { keyedLeaseKey, leaseKey } from '../lease-store';

const quiet = { level: LogLevel.Off, enableConsole: false };
const ran: Array<{ duty: object; at: number }> = [];
let nextKey: () => string = () => 'main';
let nextPrefer = false;

@Duty({ name: 'keep-file', every: 100, scope: { key: () => nextKey() } })
class KeepFileDuty {
  run(): void {
    ran.push({ duty: this, at: Date.now() });
  }
}

@Duty({ name: 'serve-dashboard', every: 100, scope: 'machine', prefer: () => nextPrefer })
class DashboardDuty {
  run(): void {
    ran.push({ duty: this, at: Date.now() });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(20);
  }
}

describe('keyedLeaseKey', () => {
  it('is the same for one key from any folder, and apart from the machine and workspace leases', () => {
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue('/srv/worktree-a');
    const key = keyedLeaseKey('indexer', '/srv/main', 'lens');
    cwd.mockReturnValue('/srv/worktree-b');
    expect(keyedLeaseKey('indexer', '/srv/main', 'lens')).toBe(key);
    expect(keyedLeaseKey('indexer', '/srv/other', 'lens')).not.toBe(key);
    expect(key).not.toBe(leaseKey('indexer', 'machine', 'lens'));
    expect(key).not.toBe(leaseKey('indexer', 'workspace', 'lens'));
    cwd.mockRestore();
  });
});

describe('duties with a lease the app names, and a preferred process', () => {
  let home: string;
  let previousHome: string | undefined;
  let open: FrontMcpContainer[];

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'sdk-duty-keys-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    ran.length = 0;
    nextKey = () => 'main';
    nextPrefer = false;
    open = [];
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(open.map((opened) => opened.dispose()));
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  async function processWith(provider: typeof KeepFileDuty | typeof DashboardDuty): Promise<object> {
    const container = await createContainer({
      providers: [provider],
      runDuties: true,
      info: { name: 'keys-spec' },
      logging: quiet,
    });
    open.push(container);
    return container.get(provider);
  }

  it('runs a duty in one process per key, whatever folder each runs from', async () => {
    const cwd = jest.spyOn(process, 'cwd');
    cwd.mockReturnValue(path.join(home, 'worktree-a'));
    const first = await processWith(KeepFileDuty);
    cwd.mockReturnValue(path.join(home, 'worktree-b'));
    const second = await processWith(KeepFileDuty);
    nextKey = () => 'other';
    const otherKey = await processWith(KeepFileDuty);

    await until(() => ran.some(({ duty }) => duty === otherKey) && ran.some(({ duty }) => duty === first));
    await sleep(300);

    expect(ran.some(({ duty }) => duty === second)).toBe(false);
  });

  it('trims the key a function answers, as it does a literal one', async () => {
    const first = await processWith(KeepFileDuty);
    nextKey = () => ' main\n';
    const second = await processWith(KeepFileDuty);

    await until(() => ran.some(({ duty }) => duty === first));
    await sleep(300);

    expect(ran.some(({ duty }) => duty === second)).toBe(false);
  });

  it('fails to start a duty whose key function answers a key longer than 1024 characters', async () => {
    nextKey = () => 'k'.repeat(1_025);
    await expect(processWith(KeepFileDuty)).rejects.toThrow(
      'Duty "keep-file" could not name its lease: scope.key answered a key longer than 1024 characters',
    );
    nextKey = () => ` ${'k'.repeat(1_024)} `;
    await expect(processWith(KeepFileDuty)).resolves.toBeDefined();
  });

  it('fails to start a duty whose key function throws or answers no string', async () => {
    nextKey = () => {
      throw new Error('no checkout');
    };
    await expect(processWith(KeepFileDuty)).rejects.toThrow(DutyLeaseKeyError);
    nextKey = () => '' as string;
    await expect(processWith(KeepFileDuty)).rejects.toThrow(
      'Duty "keep-file" could not name its lease: scope.key answered no string',
    );
  });

  it('hands the duty over to a preferred process, which keeps it', async () => {
    const other = await processWith(DashboardDuty);
    await until(() => ran.some(({ duty }) => duty === other));

    nextPrefer = true;
    const preferred = await processWith(DashboardDuty);
    await until(() => ran.some(({ duty }) => duty === preferred));
    const takenOverAt = ran.find(({ duty }) => duty === preferred)?.at ?? 0;
    await sleep(500);

    expect(ran.filter(({ duty, at }) => duty === other && at >= takenOverAt)).toEqual([]);
  });
});
