import { useEffect, useLayoutEffect } from 'react';

/** `useLayoutEffect` in the browser, where it runs at commit before any passive effect; `useEffect` when rendering on a server. */
export const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;
