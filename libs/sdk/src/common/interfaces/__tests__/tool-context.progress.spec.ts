import { ProviderNotAvailableError } from '../../../errors';
import { ToolContext } from '../../index';

class ReportTool extends ToolContext {
  async execute() {
    return {};
  }
}

function toolWithProgressToken(progressToken: string | number | undefined) {
  const sendProgressNotification = jest.fn().mockReturnValue(true);
  const providers = {
    get: () => {
      throw new ProviderNotAvailableError('FrontMcpContext', 'not found in local or parent registries');
    },
    getScope: () => ({ notifications: { sendProgressNotification } }),
  };
  const logger = { child: () => logger, debug: jest.fn(), warn: jest.fn() };
  const tool = new ReportTool({
    metadata: { name: 'report' } as never,
    input: {},
    providers: providers as never,
    logger: logger as never,
    authInfo: { sessionId: 'session-1' },
    progressToken,
  });
  return { tool, sendProgressNotification };
}

describe('ToolContext.progress() on a session (#1170)', () => {
  it.each([0, '', 'token-1', 7])('sends progress for the progress token %j', async (progressToken) => {
    const { tool, sendProgressNotification } = toolWithProgressToken(progressToken);

    await expect(tool.progress(1, 2, 'first step')).resolves.toBe(true);
    expect(sendProgressNotification).toHaveBeenCalledWith('session-1', progressToken, 1, 2, 'first step');
  });

  it('sends nothing when the request carries no progress token', async () => {
    const { tool, sendProgressNotification } = toolWithProgressToken(undefined);

    await expect(tool.progress(1, 2)).resolves.toBe(false);
    expect(sendProgressNotification).not.toHaveBeenCalled();
  });
});
