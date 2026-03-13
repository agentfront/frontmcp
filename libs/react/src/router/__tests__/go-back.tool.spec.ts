import { GoBackTool } from '../go-back.tool';
import { setNavigate, clearBridge } from '../router-bridge';
import type { NavigateFn } from '../router-bridge';

describe('GoBackTool', () => {
  beforeEach(() => {
    clearBridge();
  });

  it('has correct static metadata', () => {
    expect(GoBackTool.toolName).toBe('go_back');
    expect(GoBackTool.description).toBe('Go back to the previous page in browser history');
    expect(GoBackTool.inputSchema).toEqual({
      type: 'object',
      properties: {},
    });
  });

  it('calls navigate(-1) when bridge connected', async () => {
    const mockNav: NavigateFn = jest.fn();
    setNavigate(mockNav);

    const result = await GoBackTool.execute();

    expect(mockNav).toHaveBeenCalledWith(-1);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Navigated back' }],
    });
  });

  it('returns error message when bridge not connected', async () => {
    // Bridge is cleared in beforeEach
    const result = await GoBackTool.execute();

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Router bridge not connected. Ensure useRouterBridge() is called inside a React Router tree.',
        },
      ],
    });
  });
});
