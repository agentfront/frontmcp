import { ProcessManager } from '../manager';

const startSupervisor = jest.fn().mockResolvedValue(undefined);
const supervisorCtor = jest.fn();
jest.mock('../spawn', () => ({
  Supervisor: class {
    constructor(opts: unknown) {
      supervisorCtor(opts);
    }
    start = startSupervisor;
  },
}));

const pidData = {
  pid: 111,
  name: 'svc',
  entry: '/srv/main.ts',
  port: 4100,
  socketPath: '/tmp/svc.sock',
  dbPath: '/tmp/svc.sqlite',
  maxRestarts: 3,
  startedAt: new Date().toISOString(),
  restartCount: 0,
  supervisorPid: 110,
  cliVersion: '1.0.0',
};
const readPidFile = jest.fn();
jest.mock('../pidfile', () => ({
  readPidFile: (...a: unknown[]) => readPidFile(...a),
  isProcessAlive: () => false,
  listPidFiles: () => [],
  removePidFile: jest.fn(),
}));

describe('ProcessManager.restart (#642)', () => {
  beforeEach(() => {
    supervisorCtor.mockClear();
    readPidFile.mockReset();
  });

  it('restarts with the original port, socket, db and restart limit', async () => {
    readPidFile.mockReturnValue(pidData);

    const info = await new ProcessManager().restart('svc');

    expect(supervisorCtor).toHaveBeenCalledWith({
      name: 'svc',
      entry: '/srv/main.ts',
      port: 4100,
      socketPath: '/tmp/svc.sock',
      dbPath: '/tmp/svc.sqlite',
      maxRestarts: 3,
      socket: true,
    });
    expect(info.name).toBe('svc');
  });

  it('fails for an unknown process', async () => {
    readPidFile.mockReturnValue(null);
    await expect(new ProcessManager().restart('nope')).rejects.toThrow('Cannot restart');
  });
});
