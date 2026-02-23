import { spawn } from 'child_process';
import { EventEmitter } from 'events';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

import inspectorExecutor from './inspector.impl';

const mockContext = {
  root: '/workspace',
  projectName: 'demo',
  projectsConfigurations: { version: 2, projects: { demo: { root: 'apps/demo' } } },
  cwd: '/workspace',
  isVerbose: false,
  projectGraph: { nodes: {}, dependencies: {} },
  nxJsonConfiguration: {},
} as any;

describe('inspector executor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should spawn frontmcp inspector', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = inspectorExecutor({}, mockContext);
    const first = await gen.next();

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      ['frontmcp', 'inspector'],
      expect.objectContaining({ cwd: '/workspace' }),
    );
    expect(first.value?.success).toBe(true);

    const secondPromise = gen.next();
    mockChild.emit('close');
    const second = await secondPromise;
    expect(second.value?.success).toBe(true);
  });

  it('should pass port option', async () => {
    const mockChild = new EventEmitter();
    (spawn as jest.Mock).mockReturnValue(mockChild);

    const gen = inspectorExecutor({ port: 9229 }, mockContext);
    await gen.next();

    expect(spawn).toHaveBeenCalledWith('npx', ['frontmcp', 'inspector', '--port', '9229'], expect.anything());

    const done = gen.next();
    mockChild.emit('close');
    await done;
  });
});
