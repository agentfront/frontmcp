import { renderHook } from '@testing-library/react';
import { getNavigate, getLocation, clearBridge } from '../router-bridge';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
let mockLocation = { pathname: '/test', search: '?q=1', hash: '#section' };

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

// Import after mock is set up
import { useRouterBridge } from '../useRouterBridge';

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
});
