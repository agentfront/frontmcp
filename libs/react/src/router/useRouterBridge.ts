/**
 * useRouterBridge — wires React Router's navigate/location into the bridge singleton.
 *
 * Must be called inside a React Router tree (e.g., <BrowserRouter>). With `routerEvents`, each navigation also
 * publishes an MCP Event (`route.changed` by default) on the provider's server.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { usePublishEvent } from '../hooks/usePublishEvent';
import { clearBridge, ROUTE_CHANGED_EVENT, setLocation, setNavigate, type NavigateFn } from './router-bridge';

export interface RouterBridgeOptions {
  /**
   * Publish an event on each navigation: `true` for `route.changed` on the provider's server, or the event name and
   * the server. The server declares the event with `createRouteChangedEvent()`. Off by default.
   */
  routerEvents?: boolean | { eventName?: string; server?: string };
}

/** Keep the bridge current, and publish navigations when `routerEvents` asks for it. */
export function useRouterBridge(options: RouterBridgeOptions = {}): void {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const { routerEvents } = options;
  const eventsOptions = typeof routerEvents === 'object' ? routerEvents : {};
  const eventName = eventsOptions.eventName ?? ROUTE_CHANGED_EVENT;
  const publish = usePublishEvent(eventsOptions.server);
  const previousPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    setNavigate(navigate as NavigateFn);
    return () => {
      clearBridge();
    };
  }, [navigate]);

  useEffect(() => {
    setLocation({ pathname, search, hash });
    const path = `${pathname}${search}${hash}`;
    const previous = previousPath.current;
    previousPath.current = path;
    if (!routerEvents || previous === undefined || previous === path) return;
    publish(eventName, { pathname, search, hash, previous }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[frontmcp] the navigation was not published as "${eventName}": ${message}`);
    });
  }, [pathname, search, hash, routerEvents, eventName, publish]);
}
