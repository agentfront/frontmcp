import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { ExecutorContext } from '../executor-context.js';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

import serveExecutor from './serve.impl';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & { killed: boolean; kill: jest.Mock };
  child.killed = false;
  child.kill = jest.fn(() => {
    child.killed = true;
  });
  return child;
}

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
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const gen = serveExecutor({}, mockContext);
    const first = await gen.next();

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining('npx'),
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
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const gen = serveExecutor({}, mockContext);
    await gen.next();

    const secondPromise = gen.next();
    mockChild.emit('close', 1);
    const second = await secondPromise;
    expect(second.value?.success).toBe(false);
  });

  it('should report failure on error event', async () => {
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const gen = serveExecutor({}, mockContext);
    await gen.next();

    const secondPromise = gen.next();
    mockChild.emit('error', new Error('spawn ENOENT'));
    const second = await secondPromise;
    expect(second.value?.success).toBe(false);
  });

  it('should report failure when close emits null', async () => {
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const gen = serveExecutor({}, mockContext);
    await gen.next();

    const secondPromise = gen.next();
    mockChild.emit('close', null);
    const second = await secondPromise;
    expect(second.value?.success).toBe(false);
  });

  it('should pass port and maxRestarts', async () => {
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const gen = serveExecutor({ port: 8080, maxRestarts: 10 }, mockContext);
    await gen.next();

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining('npx'),
      ['frontmcp', 'start', 'demo', '--port', '8080', '--max-restarts', '10'],
      expect.anything(),
    );

    const done = gen.next();
    mockChild.emit('close', 0);
    await done;
  });

  it('should pass entry option', async () => {
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const gen = serveExecutor({ entry: 'src/main.ts' }, mockContext);
    await gen.next();

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringContaining('npx'),
      ['frontmcp', 'start', 'demo', '--entry', 'src/main.ts'],
      expect.anything(),
    );

    const done = gen.next();
    mockChild.emit('close', 0);
    await done;
  });

  it('should omit projectName from args when undefined', async () => {
    const mockChild = createMockChild();
    mockSpawn.mockReturnValue(mockChild as never);

    const contextWithoutProject = { ...mockContext, projectName: undefined };
    const gen = serveExecutor({}, contextWithoutProject);
    await gen.next();

    expect(mockSpawn).toHaveBeenCalledWith(expect.stringContaining('npx'), ['frontmcp', 'start'], expect.anything());

    const done = gen.next();
    mockChild.emit('close', 0);
    await done;
  });
});
