import 'reflect-metadata';

describe('the authorities engine loaded on demand', () => {
  afterEach(() => {
    jest.dontMock('../../front-mcp/authorities-engine');
  });

  it('starts the scope with a warning when the engine module fails to load, as when building the engine fails', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../../front-mcp/authorities-engine', () => {
        throw new Error('chunk load failed');
      });
      const common = await import('../../common');
      const { create } = await import('../../direct/create');
      const warnings: string[] = [];
      class WarningCapture extends common.LogTransportInterface {
        log(record: { message: string }): void {
          warnings.push(record.message);
        }
      }
      common.LogTransport({ name: 'AuthoritiesEngineLoadCapture', description: 'Captures warnings' })(WarningCapture);
      class PingTool extends common.ToolContext {
        async execute() {
          return { pong: true };
        }
      }
      common.Tool({ name: 'ping', inputSchema: {} })(PingTool);

      const server = await create({
        info: { name: 'authorities-engine-load', version: '1.0.0' },
        tools: [PingTool],
        authorities: { claimsMapping: { roles: 'roles' }, profiles: {} },
        logging: { level: common.LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
      });
      try {
        expect(await server.callTool('ping', {})).toMatchObject({ structuredContent: { pong: true } });
        expect(warnings).toContainEqual(expect.stringContaining('authorities init failed — chunk load failed'));
      } finally {
        await server.dispose();
      }
    });
  });
});
