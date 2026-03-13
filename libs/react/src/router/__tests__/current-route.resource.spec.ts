import { CurrentRouteResource } from '../current-route.resource';
import { setLocation, clearBridge } from '../router-bridge';
import type { BridgeLocation } from '../router-bridge';

describe('CurrentRouteResource', () => {
  beforeEach(() => {
    clearBridge();
  });

  it('has correct static metadata', () => {
    expect(CurrentRouteResource.uri).toBe('route://current');
    expect(CurrentRouteResource.resourceName).toBe('Current Route');
    expect(CurrentRouteResource.description).toBe('Read the current URL path, search params, and hash');
  });

  it('returns location data when bridge connected', async () => {
    const location: BridgeLocation = {
      pathname: '/users/42',
      search: '?tab=profile',
      hash: '#bio',
    };
    setLocation(location);

    const result = await CurrentRouteResource.read();

    expect(result).toEqual({
      contents: [
        {
          uri: 'route://current',
          mimeType: 'application/json',
          text: JSON.stringify({
            pathname: '/users/42',
            search: '?tab=profile',
            hash: '#bio',
            href: '/users/42?tab=profile#bio',
          }),
        },
      ],
    });
  });

  it('returns error when bridge not connected', async () => {
    // Bridge is cleared in beforeEach
    const result = await CurrentRouteResource.read();

    expect(result).toEqual({
      contents: [
        {
          uri: 'route://current',
          mimeType: 'application/json',
          text: JSON.stringify({
            error: 'Router bridge not connected. Ensure useRouterBridge() is called inside a React Router tree.',
          }),
        },
      ],
    });
  });

  it('returns correct href with empty search and hash', async () => {
    const location: BridgeLocation = {
      pathname: '/home',
      search: '',
      hash: '',
    };
    setLocation(location);

    const result = await CurrentRouteResource.read();
    const parsed = JSON.parse(result.contents[0].text);

    expect(parsed.href).toBe('/home');
    expect(parsed.pathname).toBe('/home');
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe('');
  });

  it('returns correct href with only search params', async () => {
    const location: BridgeLocation = {
      pathname: '/search',
      search: '?q=test&page=2',
      hash: '',
    };
    setLocation(location);

    const result = await CurrentRouteResource.read();
    const parsed = JSON.parse(result.contents[0].text);

    expect(parsed.href).toBe('/search?q=test&page=2');
  });
});
