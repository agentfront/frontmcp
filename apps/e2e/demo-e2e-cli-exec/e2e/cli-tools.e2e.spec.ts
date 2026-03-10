import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Tool Commands', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should execute add tool with two numbers', () => {
    const { stdout, exitCode } = runCli(['add', '--a', '3', '--b', '5']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('8');
  });

  it('should execute greet tool with required name', () => {
    const { stdout, exitCode } = runCli(['greet', '--name', 'Alice']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Alice');
  });

  it('should execute greet tool with optional greeting', () => {
    const { stdout, exitCode } = runCli(['greet', '--name', 'Bob', '--greeting', 'Hey']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Bob');
    expect(stdout).toContain('Hey');
  });

  it('should execute transform-data with JSON object argument', () => {
    const { stdout, exitCode } = runCli(['transform-data', '--data', '{"key":"myKey","value":"myValue"}']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('myKey');
    expect(stdout).toContain('myValue');
  });

  it('should execute doctor-tool (conflict-renamed tool)', () => {
    const { stdout, exitCode } = runCli(['doctor-tool', '--text', 'test input']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('test input');
  });

  it('should execute job-tool (tool named "job" renamed to avoid conflict with job command)', () => {
    const { stdout, exitCode } = runCli(['job-tool', '--task', 'deploy']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('deploy');
  });

  it('should execute subscribe-tool (tool named "subscribe" renamed to avoid conflict)', () => {
    const { stdout, exitCode } = runCli(['subscribe-tool', '--topic', 'updates']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('updates');
  });

  it('should execute skills-tool (tool named "skills" renamed to avoid conflict with skills command)', () => {
    const { stdout, exitCode } = runCli(['skills-tool', '--category', 'math']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('math');
  });
});
