describe('setupOTel', () => {
  const mockStart = jest.fn();
  const mockShutdown = jest.fn().mockResolvedValue(undefined);
  const mockNodeSDK = jest.fn().mockImplementation(() => ({
    start: mockStart,
    shutdown: mockShutdown,
  }));
  const mockResource = jest.fn().mockImplementation((attrs: any) => ({ attributes: attrs }));
  const mockConsoleExporter = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Mock all OTel SDK packages
    jest.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: mockNodeSDK }), { virtual: true });
    jest.mock('@opentelemetry/resources', () => ({ Resource: mockResource }), { virtual: true });
    jest.mock(
      '@opentelemetry/semantic-conventions',
      () => ({
        ATTR_SERVICE_NAME: 'service.name',
        ATTR_SERVICE_VERSION: 'service.version',
      }),
      { virtual: true },
    );
    jest.mock(
      '@opentelemetry/sdk-trace-base',
      () => ({
        ConsoleSpanExporter: mockConsoleExporter,
      }),
      { virtual: true },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env['OTEL_SERVICE_NAME'];
    delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  });

  it('should create console exporter by default', () => {
    const { setupOTel } = require('../otel/otel.setup');
    const shutdown = setupOTel({ serviceName: 'test-svc' });

    expect(mockConsoleExporter).toHaveBeenCalled();
    expect(mockNodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        traceExporter: expect.any(Object),
      }),
    );
    expect(mockStart).toHaveBeenCalled();
    expect(typeof shutdown).toBe('function');
  });

  it('should use OTEL_SERVICE_NAME env var when no serviceName provided', () => {
    process.env['OTEL_SERVICE_NAME'] = 'env-service';
    const { setupOTel } = require('../otel/otel.setup');
    setupOTel({ exporter: 'console' });

    expect(mockResource).toHaveBeenCalledWith(expect.objectContaining({ 'service.name': 'env-service' }));
  });

  it('should default serviceName to frontmcp-server', () => {
    const { setupOTel } = require('../otel/otel.setup');
    setupOTel({ exporter: 'console' });

    expect(mockResource).toHaveBeenCalledWith(expect.objectContaining({ 'service.name': 'frontmcp-server' }));
  });

  it('should include serviceVersion when provided', () => {
    const { setupOTel } = require('../otel/otel.setup');
    setupOTel({ exporter: 'console', serviceVersion: '1.2.3' });

    expect(mockResource).toHaveBeenCalledWith(expect.objectContaining({ 'service.version': '1.2.3' }));
  });

  it('should return a shutdown function', async () => {
    const { setupOTel } = require('../otel/otel.setup');
    const shutdown = setupOTel({ exporter: 'console' });
    await shutdown();
    expect(mockShutdown).toHaveBeenCalled();
  });

  it('should throw when otlp exporter is requested but not installed', () => {
    jest.mock(
      '@opentelemetry/exporter-trace-otlp-http',
      () => {
        throw new Error('Module not found');
      },
      { virtual: true },
    );

    const { setupOTel } = require('../otel/otel.setup');
    expect(() => setupOTel({ exporter: 'otlp' })).toThrow('@opentelemetry/exporter-trace-otlp-http is required');
  });

  it('should create OTLP exporter with endpoint', () => {
    const mockOTLPExporter = jest.fn();
    jest.mock(
      '@opentelemetry/exporter-trace-otlp-http',
      () => ({
        OTLPTraceExporter: mockOTLPExporter,
      }),
      { virtual: true },
    );

    const { setupOTel } = require('../otel/otel.setup');
    setupOTel({ exporter: 'otlp', endpoint: 'http://collector:4318' });

    expect(mockOTLPExporter).toHaveBeenCalledWith({
      url: 'http://collector:4318/v1/traces',
    });
  });

  it('should use OTEL_EXPORTER_OTLP_ENDPOINT env var', () => {
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://env-endpoint:4318';
    const mockOTLPExporter = jest.fn();
    jest.mock(
      '@opentelemetry/exporter-trace-otlp-http',
      () => ({
        OTLPTraceExporter: mockOTLPExporter,
      }),
      { virtual: true },
    );

    const { setupOTel } = require('../otel/otel.setup');
    setupOTel({ exporter: 'otlp' });

    expect(mockOTLPExporter).toHaveBeenCalledWith({
      url: 'http://env-endpoint:4318/v1/traces',
    });
  });

  it('should throw when sdk-node is not installed', () => {
    jest.mock(
      '@opentelemetry/sdk-node',
      () => {
        throw new Error('Module not found');
      },
      { virtual: true },
    );

    const { setupOTel } = require('../otel/otel.setup');
    expect(() => setupOTel({ exporter: 'console' })).toThrow('@opentelemetry/sdk-node is required');
  });
});
