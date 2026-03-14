import { setNavigate, getNavigate, setLocation, getLocation, clearBridge } from '../router-bridge';
import type { NavigateFn, BridgeLocation } from '../router-bridge';

describe('router-bridge', () => {
  beforeEach(() => {
    clearBridge();
  });

  it('getNavigate returns null initially', () => {
    expect(getNavigate()).toBeNull();
  });

  it('getLocation returns null initially', () => {
    expect(getLocation()).toBeNull();
  });

  it('setNavigate / getNavigate stores and retrieves the navigate function', () => {
    const navigate: NavigateFn = jest.fn();
    setNavigate(navigate);
    expect(getNavigate()).toBe(navigate);
  });

  it('setLocation / getLocation stores and retrieves the location', () => {
    const location: BridgeLocation = {
      pathname: '/dashboard',
      search: '?tab=settings',
      hash: '#section',
    };
    setLocation(location);
    expect(getLocation()).toBe(location);
  });

  it('clearBridge resets both navigate and location to null', () => {
    const navigate: NavigateFn = jest.fn();
    const location: BridgeLocation = { pathname: '/', search: '', hash: '' };

    setNavigate(navigate);
    setLocation(location);

    expect(getNavigate()).not.toBeNull();
    expect(getLocation()).not.toBeNull();

    clearBridge();

    expect(getNavigate()).toBeNull();
    expect(getLocation()).toBeNull();
  });

  it('setNavigate overwrites previous value', () => {
    const nav1: NavigateFn = jest.fn();
    const nav2: NavigateFn = jest.fn();

    setNavigate(nav1);
    expect(getNavigate()).toBe(nav1);

    setNavigate(nav2);
    expect(getNavigate()).toBe(nav2);
  });

  it('setLocation overwrites previous value', () => {
    const loc1: BridgeLocation = { pathname: '/a', search: '', hash: '' };
    const loc2: BridgeLocation = { pathname: '/b', search: '?x=1', hash: '#top' };

    setLocation(loc1);
    expect(getLocation()).toBe(loc1);

    setLocation(loc2);
    expect(getLocation()).toBe(loc2);
  });
});
