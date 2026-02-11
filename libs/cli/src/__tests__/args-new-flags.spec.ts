import { parseArgs } from '../args';

describe('parseArgs - new flags', () => {
  describe('--exec flag', () => {
    it('should parse --exec flag', () => {
      const result = parseArgs(['build', '--exec']);
      expect(result.exec).toBe(true);
    });

    it('should not set exec when absent', () => {
      const result = parseArgs(['build']);
      expect(result.exec).toBeUndefined();
    });
  });

  describe('--port / -p flag', () => {
    it('should parse --port with value', () => {
      const result = parseArgs(['start', 'my-app', '--port', '3005']);
      expect(result.port).toBe(3005);
    });

    it('should parse -p short flag', () => {
      const result = parseArgs(['start', 'my-app', '-p', '8080']);
      expect(result.port).toBe(8080);
    });

    it('should return undefined for non-numeric port', () => {
      const result = parseArgs(['start', 'my-app', '--port', 'abc']);
      expect(result.port).toBeUndefined();
    });
  });

  describe('--force / -f flag', () => {
    it('should parse --force flag', () => {
      const result = parseArgs(['stop', 'my-app', '--force']);
      expect(result.force).toBe(true);
    });

    it('should parse -f short flag', () => {
      const result = parseArgs(['stop', 'my-app', '-f']);
      expect(result.force).toBe(true);
    });
  });

  describe('--max-restarts flag', () => {
    it('should parse --max-restarts with value', () => {
      const result = parseArgs(['start', 'my-app', '--max-restarts', '10']);
      expect(result.maxRestarts).toBe(10);
    });

    it('should return undefined for non-numeric value', () => {
      const result = parseArgs(['start', 'my-app', '--max-restarts', 'many']);
      expect(result.maxRestarts).toBeUndefined();
    });
  });

  describe('--follow / -F flag', () => {
    it('should parse --follow flag', () => {
      const result = parseArgs(['logs', 'my-app', '--follow']);
      expect(result.follow).toBe(true);
    });

    it('should parse -F short flag', () => {
      const result = parseArgs(['logs', 'my-app', '-F']);
      expect(result.follow).toBe(true);
    });
  });

  describe('--lines / -n flag', () => {
    it('should parse --lines with value', () => {
      const result = parseArgs(['logs', 'my-app', '--lines', '100']);
      expect(result.lines).toBe(100);
    });

    it('should parse -n short flag', () => {
      const result = parseArgs(['logs', 'my-app', '-n', '25']);
      expect(result.lines).toBe(25);
    });
  });

  describe('--registry flag', () => {
    it('should parse --registry with URL', () => {
      const result = parseArgs(['install', '@company/mcp', '--registry', 'https://npm.company.com']);
      expect(result.registry).toBe('https://npm.company.com');
    });
  });

  describe('combined PM flags', () => {
    it('should parse start with all flags', () => {
      const result = parseArgs([
        'start',
        'my-app',
        '--entry',
        './src/main.ts',
        '--port',
        '3005',
        '--socket',
        '/tmp/test.sock',
        '--db',
        '/tmp/test.db',
        '--max-restarts',
        '3',
      ]);

      expect(result._).toEqual(['start', 'my-app']);
      expect(result.entry).toBe('./src/main.ts');
      expect(result.port).toBe(3005);
      expect(result.socket).toBe('/tmp/test.sock');
      expect(result.db).toBe('/tmp/test.db');
      expect(result.maxRestarts).toBe(3);
    });

    it('should parse logs with all flags', () => {
      const result = parseArgs(['logs', 'my-app', '--follow', '--lines', '200']);

      expect(result._).toEqual(['logs', 'my-app']);
      expect(result.follow).toBe(true);
      expect(result.lines).toBe(200);
    });

    it('should parse install with all flags', () => {
      const result = parseArgs([
        'install',
        '@company/my-mcp',
        '--registry',
        'https://npm.company.com',
        '--yes',
        '--port',
        '3010',
      ]);

      expect(result._).toEqual(['install', '@company/my-mcp']);
      expect(result.registry).toBe('https://npm.company.com');
      expect(result.yes).toBe(true);
      expect(result.port).toBe(3010);
    });
  });
});
