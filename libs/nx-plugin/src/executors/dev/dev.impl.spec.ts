import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import devExecutor from './dev.impl';

const mockContext = {
  root: '/workspace',
  projectName: 'demo',
  projectsConfigurations: { version: 2, projects: { demo: { root: 'apps/demo' } } },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
} as any;

describe('dev executor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should spawn frontmcp dev', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = devExecutor({}, mockContext);
    const first = await gen.next();

    expect(spawn).toHaveBeenCalledWith('npx', ['frontmcp', 'dev'], expect.objectContaining({ cwd: '/workspace' }));
    expect(first.value?.success).toBe(true);

    // Start gen.next() before emitting close — the generator registers its
    // listener only after resuming from the first yield.
    const secondPromise = gen.next();
    mockChild.emit('close');
    const second = await secondPromise;
    expect(second.value?.success).toBe(true);
  });

  it('should pass port option', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = devExecutor({ port: 4000 }, mockContext);
    await gen.next();

    expect(spawn).toHaveBeenCalledWith('npx', ['frontmcp', 'dev', '--port', '4000'], expect.anything());

    const done = gen.next();
    mockChild.emit('close');
    await done;
  });

  it('should pass entry option', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = devExecutor({ entry: 'src/main.ts' }, mockContext);
    await gen.next();

    expect(spawn).toHaveBeenCalledWith('npx', ['frontmcp', 'dev', '--entry', 'src/main.ts'], expect.anything());

    const done = gen.next();
    mockChild.emit('close');
    await done;
  });
});
