import { toParsedArgs } from '../bridge';

describe('toParsedArgs', () => {
  it('should set the _ array with command name and positional args', () => {
    const result = toParsedArgs('start', ['my-app'], {});
    expect(result._).toEqual(['start', 'my-app']);
  });

  it('should set _ with command name only when no positional args', () => {
    const result = toParsedArgs('dev', [], {});
    expect(result._).toEqual(['dev']);
  });

  it('should map start command with all PM options', () => {
    const result = toParsedArgs('start', ['my-app'], {
      entry: './src/main.ts',
      port: 3005,
      socket: '/tmp/test.sock',
      db: '/tmp/test.db',
      maxRestarts: 3,
    });

    expect(result._).toEqual(['start', 'my-app']);
    expect(result.entry).toBe('./src/main.ts');
    expect(result.port).toBe(3005);
    expect(result.socket).toBe('/tmp/test.sock');
    expect(result.db).toBe('/tmp/test.db');
    expect(result.maxRestarts).toBe(3);
  });

  it('should map build command with exec/cli/outDir/adapter', () => {
    const result = toParsedArgs('build', [], {
      exec: true,
      cli: true,
      outDir: 'build',
      adapter: 'vercel',
    });

    expect(result._).toEqual(['build']);
    expect(result.exec).toBe(true);
    expect(result.cli).toBe(true);
    expect(result.outDir).toBe('build');
    expect(result.adapter).toBe('vercel');
  });

  it('should map test command with all test options', () => {
    const result = toParsedArgs('test', ['some-pattern'], {
      runInBand: true,
      watch: true,
      verbose: true,
      timeout: 30000,
      coverage: true,
    });

    expect(result._).toEqual(['test', 'some-pattern']);
    expect(result.runInBand).toBe(true);
    expect(result.watch).toBe(true);
    expect(result.verbose).toBe(true);
    expect(result.timeout).toBe(30000);
    expect(result.coverage).toBe(true);
  });

  it('should map create command with all create options', () => {
    const result = toParsedArgs('create', ['my-app'], {
      yes: true,
      target: 'vercel',
      redis: 'docker',
      cicd: true,
      pm: 'yarn',
      nx: true,
    });

    expect(result._).toEqual(['create', 'my-app']);
    expect(result.yes).toBe(true);
    expect(result.target).toBe('vercel');
    expect(result.redis).toBe('docker');
    expect(result.cicd).toBe(true);
    expect(result.pm).toBe('yarn');
    expect(result.nx).toBe(true);
  });

  it('should map logs command with follow/lines', () => {
    const result = toParsedArgs('logs', ['my-app'], {
      follow: true,
      lines: 200,
    });

    expect(result._).toEqual(['logs', 'my-app']);
    expect(result.follow).toBe(true);
    expect(result.lines).toBe(200);
  });

  it('should map install command with registry/yes/port', () => {
    const result = toParsedArgs('install', ['@company/my-mcp'], {
      registry: 'https://npm.company.com',
      yes: true,
      port: 3010,
    });

    expect(result._).toEqual(['install', '@company/my-mcp']);
    expect(result.registry).toBe('https://npm.company.com');
    expect(result.yes).toBe(true);
    expect(result.port).toBe(3010);
  });

  it('should handle empty options (just positional args)', () => {
    const result = toParsedArgs('list', [], {});

    expect(result._).toEqual(['list']);
    expect(result.outDir).toBeUndefined();
    expect(result.entry).toBeUndefined();
    expect(result.exec).toBeUndefined();
  });

  it('should map stop command with force flag', () => {
    const result = toParsedArgs('stop', ['my-app'], { force: true });

    expect(result._).toEqual(['stop', 'my-app']);
    expect(result.force).toBe(true);
  });

  it('should map socket command with all socket options', () => {
    const result = toParsedArgs('socket', ['./src/main.ts'], {
      socket: '/tmp/my-app.sock',
      db: '/data/app.sqlite',
      background: true,
    });

    expect(result._).toEqual(['socket', './src/main.ts']);
    expect(result.socket).toBe('/tmp/my-app.sock');
    expect(result.db).toBe('/data/app.sqlite');
    expect(result.background).toBe(true);
  });

  it('should map service command with action and name positional args', () => {
    const result = toParsedArgs('service', ['install', 'my-app'], {});

    expect(result._).toEqual(['service', 'install', 'my-app']);
  });

  it('should not set fields for undefined option values', () => {
    const result = toParsedArgs('build', [], { exec: undefined });

    expect(result.exec).toBeUndefined();
    expect('exec' in result).toBe(false);
  });
});
