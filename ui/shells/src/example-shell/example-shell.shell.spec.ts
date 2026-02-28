import { buildExampleShell } from './example-shell.shell';

describe('buildExampleShell', () => {
  it('should be defined', () => {
    expect(buildExampleShell).toBeDefined();
  });

  it('should be a function', () => {
    expect(typeof buildExampleShell).toBe('function');
  });
});
