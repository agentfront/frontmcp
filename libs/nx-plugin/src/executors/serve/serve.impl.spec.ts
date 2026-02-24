import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { ExecutorContext } from '../executor-context.js';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

import serveExecutor from './serve.impl';

const mockContext: ExecutorContext = {
  root: '/workspace',
  projectName: 'demo',
  projectsConfigurations: { version: 2, projects: { demo: { root: 'apps/demo' } } },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
};

describe('serve executor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should spawn frontmcp start', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = serveExecutor({}, mockContext);
    const first = await gen.next();

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['frontmcp', 'start', 'demo'],
      expect.objectContaining({ cwd: '/workspace' }),
    );
    expect(first.value?.success).toBe(true);

    const secondPromise = gen.next();
    mockChild.emit('close', 0);
    const second = await secondPromise;
    expect(second.value?.success).toBe(true);
  });

  it('should report failure on non-zero exit code', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = serveExecutor({}, mockContext);
    await gen.next();

    const secondPromise = gen.next();
    mockChild.emit('close', 1);
    const second = await secondPromise;
    expect(second.value?.success).toBe(false);
  });

  it('should pass port and maxRestarts', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = serveExecutor({ port: 8080, maxRestarts: 10 }, mockContext);
    await gen.next();

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['frontmcp', 'start', 'demo', '--port', '8080', '--max-restarts', '10'],
      expect.anything(),
    );

    const done = gen.next();
    mockChild.emit('close', 0);
    await done;
  });

  it('should pass entry option', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = serveExecutor({ entry: 'src/main.ts' }, mockContext);
    await gen.next();

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['frontmcp', 'start', 'demo', '--entry', 'src/main.ts'],
      expect.anything(),
    );

    const done = gen.next();
    mockChild.emit('close', 0);
    await done;
  });
});
