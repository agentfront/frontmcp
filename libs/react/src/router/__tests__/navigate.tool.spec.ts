import { NavigateTool } from '../navigate.tool';
import { setNavigate, clearBridge } from '../router-bridge';
import type { NavigateFn } from '../router-bridge';

describe('NavigateTool', () => {
  beforeEach(() => {
    clearBridge();
  });

  it('has correct static metadata', () => {
    expect(NavigateTool.toolName).toBe('navigate');
    expect(NavigateTool.description).toBe('Navigate to a URL path in the application');
    expect(NavigateTool.inputSchema).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The URL path to navigate to' },
        replace: { type: 'boolean', description: 'Replace current history entry instead of pushing' },
      },
      required: ['path'],
    });
  });

  it('navigates to path when bridge connected', async () => {
    const mockNav: NavigateFn = jest.fn();
    setNavigate(mockNav);

    const result = await NavigateTool.execute({ path: '/dashboard' });

    expect(mockNav).toHaveBeenCalledWith('/dashboard', { replace: undefined });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Navigated to /dashboard' }],
    });
  });

  it('returns error message when bridge not connected', async () => {
    // Bridge is cleared in beforeEach, so navigate is null
    const result = await NavigateTool.execute({ path: '/settings' });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Router bridge not connected. Ensure useRouterBridge() is called inside a React Router tree.',
        },
      ],
    });
  });

  it('supports replace option', async () => {
    const mockNav: NavigateFn = jest.fn();
    setNavigate(mockNav);

    const result = await NavigateTool.execute({ path: '/login', replace: true });

    expect(mockNav).toHaveBeenCalledWith('/login', { replace: true });
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Navigated to /login' }],
    });
  });

  it('passes replace as false when explicitly set', async () => {
    const mockNav: NavigateFn = jest.fn();
    setNavigate(mockNav);

    await NavigateTool.execute({ path: '/home', replace: false });

    expect(mockNav).toHaveBeenCalledWith('/home', { replace: false });
  });
});
