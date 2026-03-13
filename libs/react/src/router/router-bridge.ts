/**
 * Router bridge — module-scoped singleton holding navigate/location.
 *
 * Single-threaded browser context means no async context needed.
 * `useRouterBridge()` populates this on every render/route change.
 */

export interface BridgeLocation {
  pathname: string;
  search: string;
  hash: string;
}

export type NavigateFn = (to: string | number, options?: { replace?: boolean }) => void;

let currentNavigate: NavigateFn | null = null;
let currentLocation: BridgeLocation | null = null;

export function setNavigate(fn: NavigateFn): void {
  currentNavigate = fn;
}

export function setLocation(loc: BridgeLocation): void {
  currentLocation = loc;
}

export function getNavigate(): NavigateFn | null {
  return currentNavigate;
}

export function getLocation(): BridgeLocation | null {
  return currentLocation;
}

export function clearBridge(): void {
  currentNavigate = null;
  currentLocation = null;
}
