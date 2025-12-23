// file: libs/browser/src/react/hooks/usePageContext.ts
/**
 * Hook for exposing page context to the AI agent.
 *
 * @example
 * ```tsx
 * import { usePageContext } from '@frontmcp/browser/react';
 *
 * function SignupForm() {
 *   const { registerElement, unregisterElement } = usePageContext();
 *
 *   useEffect(() => {
 *     const id = registerElement({
 *       type: 'form',
 *       name: 'SignupForm',
 *       fields: ['email', 'password', 'confirmPassword'],
 *       actions: ['submit', 'cancel'],
 *       metadata: { validation: 'enabled' },
 *     });
 *
 *     return () => unregisterElement(id);
 *   }, [registerElement, unregisterElement]);
 *
 *   return (
 *     <form>
 *       <input name="email" type="email" />
 *       <input name="password" type="password" />
 *       <input name="confirmPassword" type="password" />
 *       <button type="submit">Sign Up</button>
 *       <button type="button">Cancel</button>
 *     </form>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect } from 'react';
import { useFrontMcpContext, type PageElement } from '../context';

/**
 * Return type for usePageContext hook.
 */
export interface UsePageContextResult {
  /**
   * Register a page element for AI discovery.
   * @returns The element ID
   */
  registerElement: (element: Omit<PageElement, 'id'>) => string;

  /**
   * Unregister a page element.
   */
  unregisterElement: (id: string) => void;

  /**
   * Get all registered page elements.
   */
  getElements: () => PageElement[];

  /**
   * Check if an element is registered.
   */
  hasElement: (id: string) => boolean;
}

/**
 * Hook for exposing page context to the AI agent.
 *
 * Use this hook to register UI elements that should be visible to the AI.
 * The AI can query `page://current` to discover what's on the current page.
 *
 * @returns Page context utilities
 */
export function usePageContext(): UsePageContextResult {
  const { pageElements, registerPageElement, unregisterPageElement } = useFrontMcpContext();

  const getElements = useCallback((): PageElement[] => {
    return Array.from(pageElements.values());
  }, [pageElements]);

  const hasElement = useCallback(
    (id: string): boolean => {
      return pageElements.has(id);
    },
    [pageElements],
  );

  return {
    registerElement: registerPageElement,
    unregisterElement: unregisterPageElement,
    getElements,
    hasElement,
  };
}

/**
 * Hook that automatically registers a page element.
 *
 * This is a convenience hook that handles registration and cleanup.
 *
 * @param element - The element to register
 * @returns The element ID
 *
 * @example
 * ```tsx
 * function DataTable({ data }) {
 *   const elementId = usePageElement({
 *     type: 'table',
 *     name: 'DataTable',
 *     description: `Table with ${data.length} rows`,
 *     actions: ['sort', 'filter', 'export'],
 *   });
 *
 *   return <table>...</table>;
 * }
 * ```
 */
export function usePageElement(element: Omit<PageElement, 'id'>): string {
  const { registerElement, unregisterElement } = usePageContext();

  // Store the ID in a ref-like pattern using state
  let elementId: string | null = null;

  useEffect(() => {
    elementId = registerElement(element);

    return () => {
      if (elementId) {
        unregisterElement(elementId);
      }
    };
    // We want to re-register if element properties change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    element.type,
    element.name,
    element.description,
    JSON.stringify(element.fields),
    JSON.stringify(element.actions),
    JSON.stringify(element.metadata),
    registerElement,
    unregisterElement,
  ]);

  return elementId ?? '';
}

/**
 * Page element types for common UI patterns.
 */
export const PageElementTypes = {
  FORM: 'form',
  BUTTON: 'button',
  INPUT: 'input',
  TABLE: 'table',
  LIST: 'list',
  DIALOG: 'dialog',
  CUSTOM: 'custom',
} as const;

/**
 * Helper to create a form element description.
 */
export function createFormElement(
  name: string,
  fields: string[],
  options?: {
    description?: string;
    actions?: string[];
    metadata?: Record<string, unknown>;
  },
): Omit<PageElement, 'id'> {
  return {
    type: 'form',
    name,
    fields,
    actions: options?.actions ?? ['submit', 'reset'],
    description: options?.description,
    metadata: options?.metadata,
  };
}

/**
 * Helper to create a table element description.
 */
export function createTableElement(
  name: string,
  columns: string[],
  options?: {
    description?: string;
    actions?: string[];
    rowCount?: number;
    metadata?: Record<string, unknown>;
  },
): Omit<PageElement, 'id'> {
  return {
    type: 'table',
    name,
    fields: columns,
    actions: options?.actions ?? ['sort', 'filter'],
    description: options?.description,
    metadata: {
      ...options?.metadata,
      rowCount: options?.rowCount,
    },
  };
}

/**
 * Helper to create a dialog element description.
 */
export function createDialogElement(
  name: string,
  options?: {
    description?: string;
    actions?: string[];
    fields?: string[];
    metadata?: Record<string, unknown>;
  },
): Omit<PageElement, 'id'> {
  return {
    type: 'dialog',
    name,
    fields: options?.fields,
    actions: options?.actions ?? ['confirm', 'cancel'],
    description: options?.description,
    metadata: options?.metadata,
  };
}
