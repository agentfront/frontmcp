/**
 * The platform a session's NotificationService entry records agrees with the one the initialize
 * handler decides (#681): the MCP Apps capability the client declared counts, and a configured
 * `platformDetection.mappings` entry wins over it.
 */
import { NotificationService } from '../notification.service';

function createMockScope(platformDetection?: unknown) {
  const logger = { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    logger: { ...logger, child: jest.fn().mockReturnValue(logger) },
    providers: { cleanupSession: jest.fn() },
    resources: { subscribe: jest.fn().mockReturnValue(() => {}) },
    tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
    prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
    metadata: { transport: { platformDetection } },
  };
}

const server = { notification: jest.fn(), request: jest.fn() } as never;
const mcpApps = { experimental: { 'io.modelcontextprotocol/ui': {} } };

describe('NotificationService.setClientInfo platform', () => {
  it('records ext-apps for a client that declared MCP Apps', () => {
    const service = new NotificationService(createMockScope() as never);
    service.registerServer('s1', server);
    service.setClientCapabilities('s1', mcpApps);

    expect(service.setClientInfo('s1', { name: 'claude-ai', version: '1' })).toBe('ext-apps');
    expect(service.getPlatformType('s1')).toBe('ext-apps');
  });

  it('records the mapped platform when a platformDetection mapping matches', () => {
    const service = new NotificationService(
      createMockScope({ mappings: [{ pattern: 'gemini-cli', platform: 'gemini' }] }) as never,
    );
    service.registerServer('s1', server);
    service.setClientCapabilities('s1', mcpApps);

    expect(service.setClientInfo('s1', { name: 'gemini-cli', version: '1' })).toBe('gemini');
  });

  it('detects from the client name when no capability was declared', () => {
    const service = new NotificationService(createMockScope() as never);
    service.registerServer('s1', server);

    expect(service.setClientInfo('s1', { name: 'ChatGPT', version: '1' })).toBe('openai');
  });
});
