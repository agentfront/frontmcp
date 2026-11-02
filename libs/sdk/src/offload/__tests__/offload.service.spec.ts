import * as utils from '@frontmcp/utils';

import type { FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { OffloadAbortedError, OffloadUnsupportedRuntimeError } from '../../errors/offload.errors';
import { OffloadPool } from '../offload-pool';
import { OffloadService } from '../offload.service';
import type { OffloadRun, OffloadTask } from '../offload.types';

jest.mock('@frontmcp/utils', () => ({ ...jest.requireActual('@frontmcp/utils'), getRuntimeContext: jest.fn() }));

const logger = {
  child: () => logger,
  verbose: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const task: OffloadTask = { kind: 'function', moduleRef: { module: '/tmp/work.mjs' }, args: [] };
const call: OffloadRun = { label: 'work', logger: logger as FrontMcpLogger };

describe('OffloadService', () => {
  const runtimeContext = jest.mocked(utils.getRuntimeContext);

  beforeEach(() => {
    runtimeContext.mockReturnValue({ runtime: 'node' } as ReturnType<typeof utils.getRuntimeContext>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(['edge', 'browser', 'bun'])(
    'refuses to offload on %s, naming the runtime, without starting a pool',
    async (runtime) => {
      runtimeContext.mockReturnValue({ runtime } as ReturnType<typeof utils.getRuntimeContext>);
      const build = jest.spyOn(OffloadPool.prototype, 'run');
      const service = new OffloadService(undefined, logger as FrontMcpLogger);

      const refusal = service.run(task, call);

      await expect(refusal).rejects.toBeInstanceOf(OffloadUnsupportedRuntimeError);
      await expect(refusal).rejects.toThrow(`this server runs on "${runtime}"`);
      expect(build).not.toHaveBeenCalled();
    },
  );

  it('starts one pool on the first call, and closes it on shutdown', async () => {
    const run = jest.spyOn(OffloadPool.prototype, 'run').mockResolvedValue('done');
    const close = jest.spyOn(OffloadPool.prototype, 'close').mockResolvedValue(undefined);
    const service = new OffloadService({ maxWorkers: 1 }, logger as FrontMcpLogger);

    await expect(service.run(task, call)).resolves.toBe('done');
    await expect(service.run(task, call)).resolves.toBe('done');
    await service.onShutdown();

    expect(run).toHaveBeenCalledTimes(2);
    expect(new Set(run.mock.contexts).size).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses calls after shutdown, and shuts down without a pool', async () => {
    const service = new OffloadService(undefined, logger as FrontMcpLogger);

    await service.onShutdown();

    await expect(service.run(task, call)).rejects.toThrow(new OffloadAbortedError('work', 'shutdown'));
  });
});
