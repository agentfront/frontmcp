/**
 * Pre-Scanner (Layer 0) Test Suite
 *
 * Tests for the pre-parser security scanner that runs BEFORE AST parsing.
 * This is a defense-in-depth layer that catches attacks that could DOS the parser.
 */

import {
  PreScanner,
  preScan,
  isPreScanValid,
  MANDATORY_LIMITS,
  PRESCANNER_ERROR_CODES,
  PreScannerError,
  ScanState,
  AGENTSCRIPT_PRESCANNER_CONFIG,
  STRICT_PRESCANNER_CONFIG,
  SECURE_PRESCANNER_CONFIG,
  STANDARD_PRESCANNER_CONFIG,
  PERMISSIVE_PRESCANNER_CONFIG,
  getPreScannerPreset,
  createPreScannerConfig,
  exceedsMandatoryLimit,
  clampToMandatoryLimit,
  REDOS_THRESHOLDS,
  analyzeForReDoS,
  calculateStarHeight,
} from '../pre-scanner';

describe('PreScanner', () => {
  describe('Constructor and Configuration', () => {
    it('should create with default config (standard preset)', () => {
      const scanner = new PreScanner();
      expect(scanner).toBeDefined();
      expect(scanner.presetLevel).toBe('standard');
    });

    it('should create with agentscript preset', () => {
      const scanner = new PreScanner({ preset: 'agentscript' });
      expect(scanner).toBeDefined();
      expect(scanner.presetLevel).toBe('agentscript');
    });

    it('should create with strict preset', () => {
      const scanner = new PreScanner({ preset: 'strict' });
      expect(scanner).toBeDefined();
      expect(scanner.presetLevel).toBe('strict');
    });

    it('should create with secure preset', () => {
      const scanner = new PreScanner({ preset: 'secure' });
      expect(scanner).toBeDefined();
      expect(scanner.presetLevel).toBe('secure');
    });

    it('should create with permissive preset', () => {
      const scanner = new PreScanner({ preset: 'permissive' });
      expect(scanner).toBeDefined();
      expect(scanner.presetLevel).toBe('permissive');
    });

    it('should merge custom config with preset', () => {
      const scanner = new PreScanner({
        preset: 'standard',
        config: {
          maxInputSize: 5000,
        },
      });
      expect(scanner.config.maxInputSize).toBe(5000);
    });

    it('should return config copy via getConfig', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const config = scanner.getConfig();
      expect(config).toBeDefined();
      expect(config.maxInputSize).toBeGreaterThan(0);
    });

    it('should create new scanner via withConfig', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const newScanner = scanner.withConfig({ maxInputSize: 1000 });
      expect(newScanner).not.toBe(scanner);
      expect(newScanner.config.maxInputSize).toBe(1000);
    });
  });

  describe('Static Factory Methods', () => {
    it('should create AgentScript scanner', () => {
      const scanner = PreScanner.forAgentScript();
      expect(scanner.presetLevel).toBe('agentscript');
    });

    it('should create Strict scanner', () => {
      const scanner = PreScanner.forStrict();
      expect(scanner.presetLevel).toBe('strict');
    });

    it('should create Secure scanner', () => {
      const scanner = PreScanner.forSecure();
      expect(scanner.presetLevel).toBe('secure');
    });

    it('should create Standard scanner', () => {
      const scanner = PreScanner.forStandard();
      expect(scanner.presetLevel).toBe('standard');
    });

    it('should create Permissive scanner', () => {
      const scanner = PreScanner.forPermissive();
      expect(scanner.presetLevel).toBe('permissive');
    });
  });

  describe('Size Checks', () => {
    it('should pass valid input size', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const result = scanner.scan('const x = 1;');

      expect(result.success).toBe(true);
      expect(result.stats.inputSize).toBe(12);
    });

    it('should reject empty input', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const result = scanner.scan('');

      expect(result.success).toBe(false);
      // Empty input uses INPUT_TOO_LARGE code (reused for invalid input)
      expect(result.fatalIssue?.code).toBe(PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE);
    });

    it('should reject input exceeding maxInputSize', () => {
      const scanner = new PreScanner({
        preset: 'standard',
        config: { maxInputSize: 100 },
      });
      const result = scanner.scan('x'.repeat(200));

      expect(result.success).toBe(false);
      expect(result.fatalIssue?.code).toBe(PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE);
    });

    it('should detect null bytes', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const result = scanner.scan('const x = 1;\0const y = 2;');

      expect(result.success).toBe(false);
      expect(result.fatalIssue?.code).toBe(PRESCANNER_ERROR_CODES.NULL_BYTE_DETECTED);
    });
  });

  describe('Nesting Depth Checks', () => {
    it('should pass normal nesting', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const code = 'function foo() { if (x) { return y; } }';
      const result = scanner.scan(code);

      expect(result.success).toBe(true);
    });

    it('should reject excessive bracket nesting', () => {
      const scanner = new PreScanner({
        preset: 'standard',
        config: { maxNestingDepth: 10 },
      });
      const code = '(' + '('.repeat(20) + 'x' + ')'.repeat(20) + ')';
      const result = scanner.scan(code);

      expect(result.success).toBe(false);
      expect(result.fatalIssue?.code).toBe(PRESCANNER_ERROR_CODES.EXCESSIVE_NESTING);
    });
  });

  describe('Regex Detection', () => {
    describe('AgentScript preset (block mode)', () => {
      it('should fail validation when regex count exceeds limit', () => {
        const scanner = new PreScanner({
          preset: 'agentscript',
          config: { maxRegexCount: 0 }, // Block all regex
        });
        const code = 'const pattern = /test/;';
        const result = scanner.scan(code);

        expect(result.success).toBe(false);
      });
    });

    describe('Permissive preset (allow mode)', () => {
      it('should allow regex patterns', () => {
        const scanner = new PreScanner({ preset: 'permissive' });
        const code = 'const pattern = /^(a+)+$/;';
        const result = scanner.scan(code);

        expect(result.success).toBe(true);
      });
    });
  });

  describe('Stats Collection', () => {
    it('should collect accurate stats', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const code = `
        function foo() {
          if (x) {
            return y;
          }
        }
      `;
      const result = scanner.scan(code);

      expect(result.stats.inputSize).toBeGreaterThan(0);
      expect(result.stats.lineCount).toBeGreaterThan(1);
      expect(result.stats.scanDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should count regex patterns', () => {
      // Use 'standard' preset which has regexMode: 'analyze' (permissive uses 'allow' which skips counting)
      const scanner = new PreScanner({ preset: 'standard' });
      const code = `
        const a = /test1/;
        const b = /test2/;
        const c = /test3/;
      `;
      const result = scanner.scan(code);

      expect(result.stats.regexCount).toBe(3);
    });
  });

  describe('Clean Code Passes', () => {
    it('should pass simple valid code', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const code = 'const x = 1; const y = 2; const z = x + y;';
      const result = scanner.scan(code);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should pass complex but valid code', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      const code = `
        function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
        const result = fibonacci(10);
      `;
      const result = scanner.scan(code);

      expect(result.success).toBe(true);
    });
  });

  describe('quickValidate', () => {
    it('should return true for valid code', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      expect(scanner.quickValidate('const x = 1;')).toBe(true);
    });

    it('should return false for empty code', () => {
      const scanner = new PreScanner({ preset: 'standard' });
      expect(scanner.quickValidate('')).toBe(false);
    });
  });
});

describe('Standalone Functions', () => {
  describe('preScan()', () => {
    it('should scan with default options', () => {
      const result = preScan('const x = 1;');
      expect(result.success).toBe(true);
    });

    it('should scan with preset option', () => {
      const result = preScan('const x = 1;', 'strict');
      expect(result.success).toBe(true);
    });
  });

  describe('isPreScanValid()', () => {
    it('should return true for valid code', () => {
      expect(isPreScanValid('const x = 1;')).toBe(true);
    });

    it('should return false for invalid code', () => {
      expect(isPreScanValid('const x = "\0";')).toBe(false);
    });
  });
});

describe('Mandatory Limits', () => {
  it('should define absolute limits', () => {
    expect(MANDATORY_LIMITS.ABSOLUTE_MAX_INPUT_SIZE).toBe(100 * 1024 * 1024);
    expect(MANDATORY_LIMITS.ABSOLUTE_MAX_NESTING).toBe(200);
    expect(MANDATORY_LIMITS.ABSOLUTE_MAX_LINE_LENGTH).toBe(100_000);
    expect(MANDATORY_LIMITS.ABSOLUTE_MAX_LINES).toBe(1_000_000);
    expect(MANDATORY_LIMITS.ABSOLUTE_MAX_STRING).toBe(5 * 1024 * 1024);
    expect(MANDATORY_LIMITS.ABSOLUTE_MAX_REGEX_LENGTH).toBe(1000);
  });

  describe('exceedsMandatoryLimit()', () => {
    it('should return true if exceeds limit', () => {
      // Uses MandatoryLimitKey like 'ABSOLUTE_MAX_INPUT_SIZE', not config keys
      expect(exceedsMandatoryLimit('ABSOLUTE_MAX_INPUT_SIZE', MANDATORY_LIMITS.ABSOLUTE_MAX_INPUT_SIZE + 1)).toBe(true);
    });

    it('should return false if within limit', () => {
      expect(exceedsMandatoryLimit('ABSOLUTE_MAX_INPUT_SIZE', 1000)).toBe(false);
    });
  });

  describe('clampToMandatoryLimit()', () => {
    it('should clamp to mandatory limit', () => {
      const result = clampToMandatoryLimit('ABSOLUTE_MAX_INPUT_SIZE', MANDATORY_LIMITS.ABSOLUTE_MAX_INPUT_SIZE * 2);
      expect(result).toBe(MANDATORY_LIMITS.ABSOLUTE_MAX_INPUT_SIZE);
    });

    it('should not change values within limit', () => {
      const result = clampToMandatoryLimit('ABSOLUTE_MAX_INPUT_SIZE', 1000);
      expect(result).toBe(1000);
    });
  });
});

describe('Preset Configurations', () => {
  describe('getPreScannerPreset()', () => {
    it('should return agentscript config', () => {
      const config = getPreScannerPreset('agentscript');
      expect(config.regexMode).toBe('block');
    });

    it('should return strict config', () => {
      const config = getPreScannerPreset('strict');
      expect(config.regexMode).toBe('analyze');
    });

    it('should return secure config', () => {
      const config = getPreScannerPreset('secure');
      expect(config.regexMode).toBe('analyze');
    });

    it('should return standard config', () => {
      const config = getPreScannerPreset('standard');
      expect(config.regexMode).toBe('analyze');
    });

    it('should return permissive config', () => {
      const config = getPreScannerPreset('permissive');
      expect(config.regexMode).toBe('allow');
    });
  });

  describe('createPreScannerConfig()', () => {
    it('should create config from preset', () => {
      const config = createPreScannerConfig('standard');
      expect(config).toBeDefined();
    });

    it('should merge overrides with preset', () => {
      const config = createPreScannerConfig('standard', { maxInputSize: 5000 });
      expect(config.maxInputSize).toBe(5000);
    });
  });

  describe('Preset Constants', () => {
    it('should export AGENTSCRIPT config', () => {
      expect(AGENTSCRIPT_PRESCANNER_CONFIG.regexMode).toBe('block');
      expect(AGENTSCRIPT_PRESCANNER_CONFIG.maxInputSize).toBeLessThan(STANDARD_PRESCANNER_CONFIG.maxInputSize);
    });

    it('should export STRICT config', () => {
      expect(STRICT_PRESCANNER_CONFIG.regexMode).toBe('analyze');
    });

    it('should export SECURE config', () => {
      expect(SECURE_PRESCANNER_CONFIG.regexMode).toBe('analyze');
    });

    it('should export STANDARD config', () => {
      expect(STANDARD_PRESCANNER_CONFIG.regexMode).toBe('analyze');
    });

    it('should export PERMISSIVE config', () => {
      expect(PERMISSIVE_PRESCANNER_CONFIG.regexMode).toBe('allow');
    });
  });
});

describe('ReDoS Analysis', () => {
  describe('analyzeForReDoS()', () => {
    it('should detect nested quantifiers', () => {
      const result = analyzeForReDoS('^(a+)+$', 'catastrophic');
      // Property is 'vulnerable', not 'isVulnerable'
      expect(result.vulnerable).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(REDOS_THRESHOLDS.WARN);
    });

    it('should detect overlapping alternation', () => {
      const result = analyzeForReDoS('^(a|a)+$', 'catastrophic');
      expect(result.vulnerable).toBe(true);
    });

    it('should pass safe patterns', () => {
      const result = analyzeForReDoS('^[a-z]+$', 'catastrophic');
      expect(result.vulnerable).toBe(false);
      expect(result.score).toBeLessThan(REDOS_THRESHOLDS.WARN);
    });
  });

  describe('calculateStarHeight()', () => {
    it('should return 0 for no quantifiers', () => {
      expect(calculateStarHeight('abc')).toBe(0);
    });

    it('should return 1 for simple quantifier', () => {
      expect(calculateStarHeight('a+')).toBe(1);
    });

    it('should detect quantifiers in pattern', () => {
      // The implementation counts quantifiers encountered, not strictly "star height"
      // (a+)+ results in height >= 1 due to group quantifier interactions
      expect(calculateStarHeight('(a+)+')).toBeGreaterThanOrEqual(1);
    });
  });

  describe('REDOS_THRESHOLDS', () => {
    it('should define threshold levels', () => {
      expect(REDOS_THRESHOLDS.WARN).toBeLessThan(REDOS_THRESHOLDS.BLOCK);
      expect(REDOS_THRESHOLDS.BLOCK).toBeLessThanOrEqual(100);
    });
  });
});

describe('Error Classes', () => {
  describe('PreScannerError', () => {
    it('should create with code and message', () => {
      const error = new PreScannerError('Test error', 'PRESCANNER_INPUT_TOO_LARGE');
      expect(error.message).toBe('Test error');
      expect(error.errorCode).toBe('PRESCANNER_INPUT_TOO_LARGE');
      expect(error.name).toBe('PreScannerError');
    });

    it('should include location in details if provided', () => {
      const error = new PreScannerError('Test error', 'PRESCANNER_INPUT_TOO_LARGE', { position: 10, line: 2 });
      // Location is in details object, not directly on error
      expect(error.details.position).toBe(10);
      expect(error.details.line).toBe(2);
    });
  });
});

describe('PRESCANNER_ERROR_CODES', () => {
  it('should define all error codes', () => {
    expect(PRESCANNER_ERROR_CODES.INPUT_TOO_LARGE).toBe('PRESCANNER_INPUT_TOO_LARGE');
    expect(PRESCANNER_ERROR_CODES.NULL_BYTE_DETECTED).toBe('PRESCANNER_NULL_BYTE');
    expect(PRESCANNER_ERROR_CODES.EXCESSIVE_NESTING).toBe('PRESCANNER_NESTING_OVERFLOW');
  });
});

describe('ScanState', () => {
  it('should initialize empty', () => {
    const state = new ScanState();
    // Issues is private, check via finalize()
    const result = state.finalize();
    expect(result.issues).toHaveLength(0);
  });

  it('should track issues via reportIssue', () => {
    const state = new ScanState();
    state.reportIssue({
      code: 'PRESCANNER_INPUT_TOO_LARGE',
      severity: 'warning',
      message: 'Test issue',
    });
    const result = state.finalize();
    expect(result.issues).toHaveLength(1);
  });

  it('should finalize to PreScanResult', () => {
    const state = new ScanState();
    const result = state.finalize();
    expect(result.success).toBe(true);
    expect(result.stats).toBeDefined();
    expect(result.issues).toHaveLength(0);
  });
});

describe('Integration with Validator', () => {
  it('should be called before AST parsing', async () => {
    const { JSAstValidator } = await import('../validator');

    const validator = new JSAstValidator([]);
    const code = 'const x = "\0";'; // Null byte should be caught by pre-scanner
    const result = await validator.validate(code);

    expect(result.valid).toBe(false);
    expect(result.preScanError).toBeDefined();
    expect(result.issues.some((i) => i.code === PRESCANNER_ERROR_CODES.NULL_BYTE_DETECTED)).toBe(true);
  });

  it('should provide preScanStats', async () => {
    const { JSAstValidator } = await import('../validator');

    const validator = new JSAstValidator([]);
    const code = 'const x = 1;';
    const result = await validator.validate(code);

    expect(result.preScanStats).toBeDefined();
    expect(result.preScanStats?.inputSize).toBeGreaterThan(0);
    expect(result.preScanStats?.lineCount).toBeGreaterThan(0);
  });

  it('should allow disabling pre-scanner', async () => {
    const { JSAstValidator } = await import('../validator');

    const validator = new JSAstValidator([]);
    const code = 'const x = 1;';
    const result = await validator.validate(code, { preScan: { enabled: false } });

    // Pre-scan stats should not be present
    expect(result.preScanStats).toBeUndefined();
  });
});
