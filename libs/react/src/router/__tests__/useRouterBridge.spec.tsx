import { renderHook, waitFor } from '@testing-library/react';

import type { DirectMcpServer } from '@frontmcp/sdk';

import { serverRegistry } from '../../registry/ServerRegistry';
import { clearBridge, getLocation, getNavigate, ROUTE_CHANGED_EVENT } from '../router-bridge';
// Import after mock is set up
import { useRouterBridge } from '../useRouterBridge';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
let mockLocation = { pathname: '/test', search: '?q=1', hash: '#section' };

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useRouterBridge', () => {
  beforeEach(() => {
    clearBridge();
    jest.clearAllMocks();
    mockLocation = { pathname: '/test', search: '?q=1', hash: '#section' };
  });

  it('sets navigate and location in bridge on render', () => {
    renderHook(() => useRouterBridge());

    const nav = getNavigate();
    expect(nav).not.toBeNull();

    const loc = getLocation();
    expect(loc).toEqual({
      pathname: '/test',
      search: '?q=1',
      hash: '#section',
    });
  });

  it('updates location when route changes', () => {
    const { rerender } = renderHook(() => useRouterBridge());

    expect(getLocation()).toEqual({
      pathname: '/test',
      search: '?q=1',
      hash: '#section',
    });

    // Simulate route change
    mockLocation = { pathname: '/dashboard', search: '', hash: '' };
    rerender();

    expect(getLocation()).toEqual({
      pathname: '/dashboard',
      search: '',
      hash: '',
    });
  });

  it('clears bridge on unmount', () => {
    const { unmount } = renderHook(() => useRouterBridge());

    expect(getNavigate()).not.toBeNull();
    expect(getLocation()).not.toBeNull();

    unmount();

    expect(getNavigate()).toBeNull();
    expect(getLocation()).toBeNull();
  });

  it('navigate function from bridge calls react-router navigate', () => {
    renderHook(() => useRouterBridge());

    const nav = getNavigate();
    expect(nav).not.toBeNull();

    nav!('/new-path', { replace: true });
    expect(mockNavigate).toHaveBeenCalledWith('/new-path', { replace: true });
  });

  describe('routerEvents', () => {
    const publish = jest.fn();

    beforeEach(() => {
      serverRegistry.clear();
      publish.mockReset().mockResolvedValue({ eventId: 'evt_1', matched: 0 });
      serverRegistry.register('default', { events: { publish } } as unknown as DirectMcpServer);
      serverRegistry.register('shell', { events: { publish } } as unknown as DirectMcpServer);
    });

    it('publishes route.changed on each navigation after the first render, not on a re-render', () => {
      const { rerender } = renderHook(() => useRouterBridge({ routerEvents: true }));

      rerender();
      mockLocation = { pathname: '/orders', search: '', hash: '#top' };
      rerender();

      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        'route.changed',
        { pathname: '/orders', search: '', hash: '#top', previous: '/test?q=1#section' },
        undefined,
      );
    });

    it('publishes under the configured name on the configured server, and warns when that fails', async () => {
      publish.mockRejectedValueOnce(new Error('not registered')).mockRejectedValue('not registered');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { rerender } = renderHook(() =>
        useRouterBridge({ routerEvents: { eventName: 'page.viewed', server: 'shell' } }),
      );

      mockLocation = { pathname: '/settings', search: '', hash: '' };
      rerender();
      mockLocation = { pathname: '/profile', search: '', hash: '' };
      rerender();
      await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));

      expect(publish.mock.calls[0][0]).toBe('page.viewed');
      expect(warn.mock.calls[0][0]).toContain('"page.viewed": not registered');
      warn.mockRestore();
    });

    it('publishes nothing without routerEvents', () => {
      const { rerender } = renderHook(() => useRouterBridge());

      mockLocation = { pathname: '/elsewhere', search: '', hash: '' };
      rerender();

      expect(publish).not.toHaveBeenCalled();
    });

    it('publishes under route.changed by default', () => {
      expect(ROUTE_CHANGED_EVENT).toBe('route.changed');
    });
  });
});
