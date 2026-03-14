/**
 * useRouterBridge — wires React Router's navigate/location into the bridge singleton.
 *
 * Must be called inside a React Router tree (e.g., <BrowserRouter>).
 */

import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setNavigate, setLocation, clearBridge } from './router-bridge';
import type { NavigateFn } from './router-bridge';

export function useRouterBridge(): void {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setNavigate(navigate as NavigateFn);
    return () => {
      clearBridge();
    };
  }, [navigate]);

  useEffect(() => {
    setLocation({
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    });
  }, [location.pathname, location.search, location.hash]);
}
