import {
  auditSecurityDefaults,
  logSecurityFindings,
  resolveBindAddress,
  type SecurityAuditConfig,
  type SecurityFinding,
} from '../security-audit';

describe('auditSecurityDefaults()', () => {
  it('returns no findings in development mode (non-distributed)', () => {
    const findings = auditSecurityDefaults({}, false);
    expect(findings).toEqual([]);
  });

  it('returns findings in production mode', () => {
    const findings = auditSecurityDefaults({}, true);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('returns findings in distributed mode even if not production', () => {
    const findings = auditSecurityDefaults({ deploymentMode: 'distributed' }, false);
    expect(findings.length).toBeGreaterThan(0);
  });

  describe('CORS audit', () => {
    // The audit must match ExpressHostAdapter, which installs the CORS middleware only when
    // `origin` is neither undefined nor false. Every config below that yields no middleware has to
    // report CORS_DISABLED, or the audit tells operators they have CORS when they do not.
    it.each([
      ['omitted', undefined],
      ['false', false as const],
      ['an empty object', {}],
      ['an explicit origin: false', { origin: false }],
    ])('reports %s as no-CORS-headers, not a permissive or configured state', (_label, cors) => {
      const findings = auditSecurityDefaults({ cors }, true);

      expect(findings).toContainEqual(expect.objectContaining({ code: 'CORS_DISABLED', level: 'info' }));
      expect(findings).not.toContainEqual(expect.objectContaining({ code: 'CORS_CONFIGURED' }));
      expect(findings.filter((f) => f.level === 'warn' && f.code.startsWith('CORS_'))).toEqual([]);
    });

    it('warns when origin is explicitly true', () => {
      const findings = auditSecurityDefaults({ cors: { origin: true } }, true);

      expect(findings).toContainEqual(expect.objectContaining({ code: 'CORS_ORIGIN_TRUE', level: 'warn' }));
    });

    it('still warns about an explicit origin=true under strict mode — strict does not touch CORS', () => {
      const findings = auditSecurityDefaults({ cors: { origin: true }, security: { strict: true } }, true);

      expect(findings).toContainEqual(expect.objectContaining({ code: 'CORS_ORIGIN_TRUE', level: 'warn' }));
    });

    it('info when CORS is explicitly configured', () => {
      const findings = auditSecurityDefaults({ cors: { origin: 'https://example.com' } }, true);

      expect(findings).toContainEqual(expect.objectContaining({ code: 'CORS_CONFIGURED', level: 'info' }));
    });
  });

  describe('bind address audit', () => {
    it('warns when bound to 0.0.0.0 in non-distributed mode', () => {
      const findings = auditSecurityDefaults({ resolvedBindAddress: '0.0.0.0' }, true);
      expect(findings).toContainEqual(expect.objectContaining({ code: 'BIND_ALL_INTERFACES', level: 'warn' }));
    });

    it('info when bound to 0.0.0.0 in distributed mode', () => {
      const findings = auditSecurityDefaults({ resolvedBindAddress: '0.0.0.0', deploymentMode: 'distributed' }, true);
      expect(findings).toContainEqual(
        expect.objectContaining({ code: 'BIND_ALL_INTERFACES_DISTRIBUTED', level: 'info' }),
      );
    });

    it('info when bound to loopback', () => {
      const findings = auditSecurityDefaults({ resolvedBindAddress: '127.0.0.1' }, true);
      const bindFinding = findings.find((f) => f.code === 'BIND_RESTRICTED');
      expect(bindFinding).toBeDefined();
    });

    it('falls back to the loopback default when no resolved address is passed', () => {
      const findings = auditSecurityDefaults({}, true);
      expect(findings.find((f) => f.code === 'BIND_RESTRICTED')).toBeDefined();
      expect(findings.find((f) => f.code === 'BIND_ALL_INTERFACES')).toBeUndefined();
    });
  });

  describe('DNS rebinding audit', () => {
    it('warns when DNS rebinding protection is disabled', () => {
      const findings = auditSecurityDefaults({}, true);
      expect(findings).toContainEqual(expect.objectContaining({ code: 'DNS_REBINDING_UNPROTECTED', level: 'warn' }));
    });

    it('info when DNS rebinding protection is enabled', () => {
      const config: SecurityAuditConfig = {
        security: { dnsRebindingProtection: { enabled: true } },
      };
      const findings = auditSecurityDefaults(config, true);
      const dnsFinding = findings.find((f) => f.code === 'DNS_REBINDING_PROTECTED');
      expect(dnsFinding).toBeDefined();
    });
  });

  describe('strict mode', () => {
    it('shows strict mode enabled when strict is true', () => {
      const config: SecurityAuditConfig = {
        security: { strict: true, dnsRebindingProtection: { enabled: true } },
      };
      const findings = auditSecurityDefaults(config, true);
      const strictFinding = findings.find((f) => f.code === 'STRICT_MODE_ENABLED');
      expect(strictFinding).toBeDefined();
    });

    it('does not claim loopback binding in distributed mode, where strict still binds 0.0.0.0', () => {
      const findings = auditSecurityDefaults(
        { security: { strict: true }, deploymentMode: 'distributed', resolvedBindAddress: '0.0.0.0' },
        true,
      );
      const strictFinding = findings.find((f) => f.code === 'STRICT_MODE_ENABLED');

      expect(strictFinding).toBeDefined();
      expect(strictFinding?.message).not.toContain('loopback');
      expect(strictFinding?.message).toContain('DNS rebinding protection');
    });

    it('still names loopback binding for a standalone strict deployment', () => {
      const findings = auditSecurityDefaults({ security: { strict: true } }, true);
      const strictFinding = findings.find((f) => f.code === 'STRICT_MODE_ENABLED');

      expect(strictFinding?.message).toContain('loopback binding');
    });

    it('shows strict mode hint when strict is not set', () => {
      const findings = auditSecurityDefaults({}, true);
      const hintFinding = findings.find((f) => f.code === 'STRICT_MODE_HINT');
      expect(hintFinding).toBeDefined();
    });

    it('does not emit CORS or DNS warnings when strict mode is enabled', () => {
      const config: SecurityAuditConfig = {
        security: { strict: true },
      };
      const findings = auditSecurityDefaults(config, true);

      const corsWarn = findings.find((f) => f.level === 'warn' && f.code.startsWith('CORS_'));
      const dnsWarn = findings.find((f) => f.code === 'DNS_REBINDING_UNPROTECTED');
      expect(corsWarn).toBeUndefined();
      expect(dnsWarn).toBeUndefined();

      const strictEnabled = findings.find((f) => f.code === 'STRICT_MODE_ENABLED');
      expect(strictEnabled).toBeDefined();
    });
  });
});

describe('logSecurityFindings()', () => {
  it('logs warnings and info messages', () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const findings: SecurityFinding[] = [
      { level: 'warn', code: 'TEST_WARN', message: 'test warning' },
      { level: 'info', code: 'TEST_INFO', message: 'test info' },
    ];

    logSecurityFindings(findings, logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('includes recommendation when present', () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const findings: SecurityFinding[] = [{ level: 'warn', code: 'TEST', message: 'msg', recommendation: 'fix it' }];

    logSecurityFindings(findings, logger);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('fix it'));
  });

  it('does nothing with empty findings', () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    logSecurityFindings([], logger);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('resolveBindAddress()', () => {
  // BREAKING in v1.x: the default was 0.0.0.0. A server that did not mention security bound every
  // interface, which is how an unauthenticated MCP endpoint ended up reachable from the network in a
  // downstream consumer. Loopback is the safe default; `bindAddress: 'all'`, FRONTMCP_BIND_ADDRESS,
  // and a distributed build (FRONTMCP_DEPLOYMENT_MODE=distributed) are the documented ways back.
  const originalEnv = process.env['FRONTMCP_BIND_ADDRESS'];

  beforeEach(() => {
    delete process.env['FRONTMCP_BIND_ADDRESS'];
  });

  afterAll(() => {
    if (originalEnv === undefined) delete process.env['FRONTMCP_BIND_ADDRESS'];
    else process.env['FRONTMCP_BIND_ADDRESS'] = originalEnv;
  });

  it('returns loopback by default — a server that says nothing is local-only', () => {
    expect(resolveBindAddress()).toBe('127.0.0.1');
  });

  it('still binds all interfaces for a distributed deployment', () => {
    expect(resolveBindAddress(undefined, 'distributed')).toBe('0.0.0.0');
  });

  it('an explicit bindAddress is unaffected by the new default', () => {
    expect(resolveBindAddress({ bindAddress: 'all' })).toBe('0.0.0.0');
    expect(resolveBindAddress({ bindAddress: '10.0.0.5' })).toBe('10.0.0.5');
  });

  it('returns loopback when strict in standalone mode', () => {
    expect(resolveBindAddress({ strict: true }, 'standalone')).toBe('127.0.0.1');
  });

  it('returns 0.0.0.0 when strict in distributed mode', () => {
    expect(resolveBindAddress({ strict: true }, 'distributed')).toBe('0.0.0.0');
  });

  it('resolves loopback keyword', () => {
    expect(resolveBindAddress({ bindAddress: 'loopback' })).toBe('127.0.0.1');
  });

  it('resolves all keyword', () => {
    expect(resolveBindAddress({ bindAddress: 'all' })).toBe('0.0.0.0');
  });

  it('passes through specific IP', () => {
    expect(resolveBindAddress({ bindAddress: '192.168.1.1' })).toBe('192.168.1.1');
  });

  it('explicit bindAddress takes priority over strict', () => {
    expect(resolveBindAddress({ strict: true, bindAddress: 'all' }, 'standalone')).toBe('0.0.0.0');
  });

  describe('FRONTMCP_BIND_ADDRESS', () => {
    // The container opt-in: a Dockerfile cannot reach into the server's TypeScript config, so
    // without this a published port reaches a process listening only on 127.0.0.1.
    it('binds all interfaces when set to all', () => {
      process.env['FRONTMCP_BIND_ADDRESS'] = 'all';
      expect(resolveBindAddress()).toBe('0.0.0.0');
    });

    it('resolves the loopback keyword and a literal address', () => {
      process.env['FRONTMCP_BIND_ADDRESS'] = 'loopback';
      expect(resolveBindAddress()).toBe('127.0.0.1');
      process.env['FRONTMCP_BIND_ADDRESS'] = '10.1.2.3';
      expect(resolveBindAddress()).toBe('10.1.2.3');
    });

    it('tolerates surrounding whitespace', () => {
      process.env['FRONTMCP_BIND_ADDRESS'] = '  all  ';
      expect(resolveBindAddress()).toBe('0.0.0.0');
    });

    it('is ignored when empty', () => {
      process.env['FRONTMCP_BIND_ADDRESS'] = '   ';
      expect(resolveBindAddress()).toBe('127.0.0.1');
    });

    it('loses to an explicit bindAddress — config is the more specific statement', () => {
      process.env['FRONTMCP_BIND_ADDRESS'] = 'all';
      expect(resolveBindAddress({ bindAddress: 'loopback' })).toBe('127.0.0.1');
    });

    it('beats strict mode and the deployment mode', () => {
      process.env['FRONTMCP_BIND_ADDRESS'] = 'all';
      expect(resolveBindAddress({ strict: true }, 'standalone')).toBe('0.0.0.0');
      process.env['FRONTMCP_BIND_ADDRESS'] = 'loopback';
      expect(resolveBindAddress(undefined, 'distributed')).toBe('127.0.0.1');
    });
  });
});
