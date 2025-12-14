import { parseArgs, type ParsedArgs } from '../args';

describe('parseArgs', () => {
  describe('positional arguments', () => {
    it('should collect positional args in _ array', () => {
      const result = parseArgs(['create', 'my-project']);
      expect(result._).toEqual(['create', 'my-project']);
    });

    it('should return empty _ array when no positional args', () => {
      const result = parseArgs(['--help']);
      expect(result._).toEqual([]);
    });
  });

  describe('--yes / -y flag', () => {
    it('should parse --yes flag', () => {
      const result = parseArgs(['create', 'my-project', '--yes']);
      expect(result.yes).toBe(true);
    });

    it('should parse -y short flag', () => {
      const result = parseArgs(['create', 'my-project', '-y']);
      expect(result.yes).toBe(true);
    });

    it('should not set yes when flag is absent', () => {
      const result = parseArgs(['create', 'my-project']);
      expect(result.yes).toBeUndefined();
    });
  });

  describe('--target flag', () => {
    it('should parse --target with node value', () => {
      const result = parseArgs(['create', '--target', 'node']);
      expect(result.target).toBe('node');
    });

    it('should parse --target with vercel value', () => {
      const result = parseArgs(['create', '--target', 'vercel']);
      expect(result.target).toBe('vercel');
    });

    it('should parse --target with lambda value', () => {
      const result = parseArgs(['create', '--target', 'lambda']);
      expect(result.target).toBe('lambda');
    });

    it('should parse --target with cloudflare value', () => {
      const result = parseArgs(['create', '--target', 'cloudflare']);
      expect(result.target).toBe('cloudflare');
    });
  });

  describe('--redis flag', () => {
    it('should parse --redis with docker value', () => {
      const result = parseArgs(['create', '--redis', 'docker']);
      expect(result.redis).toBe('docker');
    });

    it('should parse --redis with existing value', () => {
      const result = parseArgs(['create', '--redis', 'existing']);
      expect(result.redis).toBe('existing');
    });

    it('should parse --redis with none value', () => {
      const result = parseArgs(['create', '--redis', 'none']);
      expect(result.redis).toBe('none');
    });
  });

  describe('--cicd / --no-cicd flags', () => {
    it('should parse --cicd flag as true', () => {
      const result = parseArgs(['create', '--cicd']);
      expect(result.cicd).toBe(true);
    });

    it('should parse --no-cicd flag as false', () => {
      const result = parseArgs(['create', '--no-cicd']);
      expect(result.cicd).toBe(false);
    });

    it('should not set cicd when flag is absent', () => {
      const result = parseArgs(['create']);
      expect(result.cicd).toBeUndefined();
    });
  });

  describe('--help / -h flag', () => {
    it('should parse --help flag', () => {
      const result = parseArgs(['--help']);
      expect(result.help).toBe(true);
    });

    it('should parse -h short flag', () => {
      const result = parseArgs(['-h']);
      expect(result.help).toBe(true);
    });
  });

  describe('--out-dir / -o flag', () => {
    it('should parse --out-dir with value', () => {
      const result = parseArgs(['build', '--out-dir', 'dist/custom']);
      expect(result.outDir).toBe('dist/custom');
    });

    it('should parse -o short flag with value', () => {
      const result = parseArgs(['build', '-o', 'dist/custom']);
      expect(result.outDir).toBe('dist/custom');
    });
  });

  describe('--entry / -e flag', () => {
    it('should parse --entry with value', () => {
      const result = parseArgs(['build', '--entry', 'src/server.ts']);
      expect(result.entry).toBe('src/server.ts');
    });

    it('should parse -e short flag with value', () => {
      const result = parseArgs(['build', '-e', 'src/server.ts']);
      expect(result.entry).toBe('src/server.ts');
    });
  });

  describe('--adapter / -a flag', () => {
    it('should parse --adapter with value', () => {
      const result = parseArgs(['build', '--adapter', 'vercel']);
      expect(result.adapter).toBe('vercel');
    });

    it('should parse -a short flag with value', () => {
      const result = parseArgs(['build', '-a', 'lambda']);
      expect(result.adapter).toBe('lambda');
    });
  });

  describe('--verbose / -v flag', () => {
    it('should parse --verbose flag', () => {
      const result = parseArgs(['dev', '--verbose']);
      expect(result.verbose).toBe(true);
    });

    it('should parse -v short flag', () => {
      const result = parseArgs(['dev', '-v']);
      expect(result.verbose).toBe(true);
    });
  });

  describe('--watch / -w flag', () => {
    it('should parse --watch flag', () => {
      const result = parseArgs(['test', '--watch']);
      expect(result.watch).toBe(true);
    });

    it('should parse -w short flag', () => {
      const result = parseArgs(['test', '-w']);
      expect(result.watch).toBe(true);
    });
  });

  describe('--timeout / -t flag', () => {
    it('should parse --timeout with numeric value', () => {
      const result = parseArgs(['test', '--timeout', '5000']);
      expect(result.timeout).toBe(5000);
    });

    it('should parse -t short flag with numeric value', () => {
      const result = parseArgs(['test', '-t', '10000']);
      expect(result.timeout).toBe(10000);
    });

    it('should return undefined for non-numeric timeout', () => {
      const result = parseArgs(['test', '--timeout', 'invalid']);
      expect(result.timeout).toBeUndefined();
    });
  });

  describe('--runInBand / -i flag', () => {
    it('should parse --runInBand flag', () => {
      const result = parseArgs(['test', '--runInBand']);
      expect(result.runInBand).toBe(true);
    });

    it('should parse -i short flag', () => {
      const result = parseArgs(['test', '-i']);
      expect(result.runInBand).toBe(true);
    });
  });

  describe('combined flags', () => {
    it('should parse multiple flags together', () => {
      const result = parseArgs(['create', 'my-project', '--yes', '--target', 'vercel', '--cicd']);

      expect(result._).toEqual(['create', 'my-project']);
      expect(result.yes).toBe(true);
      expect(result.target).toBe('vercel');
      expect(result.cicd).toBe(true);
    });

    it('should parse create command with all flags', () => {
      const result = parseArgs(['create', 'my-app', '-y', '--target', 'node', '--redis', 'docker', '--cicd']);

      expect(result._).toEqual(['create', 'my-app']);
      expect(result.yes).toBe(true);
      expect(result.target).toBe('node');
      expect(result.redis).toBe('docker');
      expect(result.cicd).toBe(true);
    });
  });
});
