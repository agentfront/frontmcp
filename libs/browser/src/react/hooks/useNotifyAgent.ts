// file: libs/browser/src/react/hooks/useNotifyAgent.ts
/**
 * Hook for sending notifications to the AI agent.
 *
 * @example
 * ```tsx
 * import { useNotifyAgent } from '@frontmcp/browser/react';
 *
 * function FormComponent() {
 *   const notify = useNotifyAgent();
 *
 *   const handleSubmit = () => {
 *     // Notify the agent about the form submission
 *     notify('user-action', {
 *       action: 'form-submitted',
 *       formId: 'signup',
 *       timestamp: Date.now(),
 *     });
 *   };
 *
 *   return (
 *     <form onSubmit={handleSubmit}>
 *       <button type="submit">Submit</button>
 *     </form>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect } from 'react';
import { useFrontMcpContext } from '../context';

/**
 * Common notification event types.
 */
export type NotificationEventType =
  | 'user-action'
  | 'navigation'
  | 'error'
  | 'state-change'
  | 'focus-change'
  | 'visibility-change'
  | 'custom';

/**
 * Return type for useNotifyAgent hook.
 */
export type NotifyAgentFn = (type: NotificationEventType | string, data: unknown) => void;

/**
 * Hook to send notifications to the AI agent.
 *
 * @returns Function to send notifications
 */
export function useNotifyAgent(): NotifyAgentFn {
  const { notifyAgent } = useFrontMcpContext();

  return useCallback(
    (type: NotificationEventType | string, data: unknown): void => {
      notifyAgent(type, data);
    },
    [notifyAgent],
  );
}

/**
 * Hook to automatically notify on navigation changes.
 *
 * @example
 * ```tsx
 * function App() {
 *   useNavigationNotifier();
 *   return <Router>...</Router>;
 * }
 * ```
 */
export function useNavigationNotifier(): void {
  const notify = useNotifyAgent();

  useEffect(() => {
    // This would need to be connected to your router
    // Here's a basic implementation using popstate
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      notify('navigation', {
        url: window.location.href,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [notify]);
}

/**
 * Hook to automatically notify on visibility changes.
 *
 * @example
 * ```tsx
 * function App() {
 *   useVisibilityNotifier();
 *   return <YourApp />;
 * }
 * ```
 */
export function useVisibilityNotifier(): void {
  const notify = useNotifyAgent();

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      notify('visibility-change', {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [notify]);
}

/**
 * Hook to automatically notify on focus changes.
 *
 * @example
 * ```tsx
 * function App() {
 *   useFocusNotifier();
 *   return <YourApp />;
 * }
 * ```
 */
export function useFocusNotifier(): void {
  const notify = useNotifyAgent();

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleFocus = () => {
      notify('focus-change', { focused: true });
    };

    const handleBlur = () => {
      notify('focus-change', { focused: false });
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [notify]);
}
