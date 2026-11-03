import { redirectConsoleToStderr } from '../stdio-console';

const METHODS = ['log', 'info', 'debug', 'dir', 'table', 'time', 'timeLog', 'group', 'groupEnd', 'count'] as const;

describe('redirectConsoleToStderr', () => {
  const original = Object.fromEntries(METHODS.map((method) => [method, console[method]]));

  afterEach(() => {
    Object.assign(console, original);
  });

  it('sends what the console would print on stdout to stderr instead', () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      redirectConsoleToStderr();
      console.log('to the log');
      console.info('for information');
      console.count('counted');

      expect(stdout).not.toHaveBeenCalled();
      const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(written).toContain('to the log');
      expect(written).toContain('for information');
      expect(written).toContain('counted: 1');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
