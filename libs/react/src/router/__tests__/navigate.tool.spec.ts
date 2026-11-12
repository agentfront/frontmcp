import { NavigateTool } from '../navigate.tool';
import { clearBridge, setNavigate, type NavigateFn } from '../router-bridge';

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

  it.each([
    ['another origin', '//elsewhere.example/login'],
    ['an absolute URL of another origin', 'https://elsewhere.example/'],
    ['a backslash', String.raw`/\elsewhere.example`],
    ['a relative backslash', String.raw`\elsewhere.example`],
    ['a tab', '\t/elsewhere.example'],
    ['a scheme', 'javascript:void(0)'],
  ])('does not navigate to a path with %s', async (_label, path) => {
    const mockNav: NavigateFn = jest.fn();
    setNavigate(mockNav);

    const result = await NavigateTool.execute({ path });

    expect(mockNav).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('Not navigated to');
  });

  it('navigates to a relative path, with a query and a fragment', async () => {
    const mockNav: NavigateFn = jest.fn();
    setNavigate(mockNav);

    await NavigateTool.execute({ path: '../settings?tab=profile#name' });

    expect(mockNav).toHaveBeenCalledWith('../settings?tab=profile#name', { replace: undefined });
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
