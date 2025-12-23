// file: libs/browser/src/react/hooks/useElicit.ts
/**
 * Hook for human-in-the-loop interactions.
 *
 * @example
 * ```tsx
 * import { useElicit, ElicitDialog } from '@frontmcp/browser/react';
 *
 * function App() {
 *   const { pendingRequest, respond, dismiss } = useElicit();
 *
 *   return (
 *     <div>
 *       <YourApp />
 *       {pendingRequest && (
 *         <ElicitDialog
 *           request={pendingRequest}
 *           onRespond={respond}
 *           onDismiss={dismiss}
 *         />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */

import { useFrontMcpContext, type ElicitRequest } from '../context';

/**
 * Return type for useElicit hook.
 */
export interface UseElicitResult {
  /**
   * Currently pending elicit request from the AI agent.
   * Will be null if there's no pending request.
   */
  pendingRequest: ElicitRequest | null;

  /**
   * Whether there's a pending elicit request.
   */
  hasPendingRequest: boolean;

  /**
   * Respond to the current elicit request.
   * @param response - The user's response
   */
  respond: (response: unknown) => void;

  /**
   * Dismiss the current elicit request without responding.
   */
  dismiss: () => void;
}

/**
 * Hook for handling human-in-the-loop interactions.
 *
 * The AI agent can request user input or confirmation through the `elicit` tool.
 * This hook provides access to pending requests and methods to respond.
 *
 * @returns Elicit request state and handlers
 */
export function useElicit(): UseElicitResult {
  const { pendingElicitRequest, respondToElicit, dismissElicit } = useFrontMcpContext();

  return {
    pendingRequest: pendingElicitRequest,
    hasPendingRequest: pendingElicitRequest !== null,
    respond: respondToElicit,
    dismiss: dismissElicit,
  };
}

/**
 * Helper to format elicit request for display.
 */
export function formatElicitRequest(request: ElicitRequest): {
  title: string;
  message: string;
  type: string;
  options?: string[];
  hasTimeout: boolean;
} {
  const typeLabels: Record<string, string> = {
    confirm: 'Confirmation',
    select: 'Selection',
    input: 'Input Required',
    form: 'Form Input',
  };

  return {
    title: typeLabels[request.type] || 'Request',
    message: request.message,
    type: request.type,
    options: request.options,
    hasTimeout: request.timeout !== undefined && request.timeout > 0,
  };
}

/**
 * Type guard to check if a request is a confirmation type.
 */
export function isConfirmRequest(request: ElicitRequest): boolean {
  return request.type === 'confirm';
}

/**
 * Type guard to check if a request is a selection type.
 */
export function isSelectRequest(request: ElicitRequest): boolean {
  return request.type === 'select';
}

/**
 * Type guard to check if a request is an input type.
 */
export function isInputRequest(request: ElicitRequest): boolean {
  return request.type === 'input';
}

/**
 * Type guard to check if a request is a form type.
 */
export function isFormRequest(request: ElicitRequest): boolean {
  return request.type === 'form';
}
