// file: libs/browser/src/react/__tests__/react-exports.spec.ts
/**
 * Tests for React integration exports and utility functions.
 *
 * These tests verify that:
 * 1. All exports are available from the React module
 * 2. Helper functions work correctly
 * 3. Type guards function as expected
 */

import {
  // Context exports
  FrontMcpContext,
  useFrontMcpContext,

  // Hook exports
  useStore,
  useStoreKey,
  useTool,
  useToolInfo,
  useToolsList,
  useResource,
  useResourcesList,
  useMcp,
  useMcpAvailable,
  useMcpStatus,
  useNotifyAgent,
  useNavigationNotifier,
  useVisibilityNotifier,
  useFocusNotifier,
  usePageContext,
  usePageElement,
  PageElementTypes,
  createFormElement,
  createTableElement,
  createDialogElement,
  useRegisterComponent,
  useRegisteredComponents,
  useComponentSearch,
  useComponentsByCategory,
  useComponentsByTag,
  useElicit,
  formatElicitRequest,
  isConfirmRequest,
  isSelectRequest,
  isInputRequest,
  isFormRequest,

  // Component exports
  ElicitDialog,
  UIResourceRenderer,
  isUIResource,
  useUIResource,
} from '../index';

describe('React Integration Exports', () => {
  describe('Context exports', () => {
    it('should export FrontMcpContext', () => {
      expect(FrontMcpContext).toBeDefined();
    });

    it('should export useFrontMcpContext hook', () => {
      expect(useFrontMcpContext).toBeInstanceOf(Function);
    });
  });

  describe('Hook exports', () => {
    it('should export store hooks', () => {
      expect(useStore).toBeInstanceOf(Function);
      expect(useStoreKey).toBeInstanceOf(Function);
    });

    it('should export tool hooks', () => {
      expect(useTool).toBeInstanceOf(Function);
      expect(useToolInfo).toBeInstanceOf(Function);
      expect(useToolsList).toBeInstanceOf(Function);
    });

    it('should export resource hooks', () => {
      expect(useResource).toBeInstanceOf(Function);
      expect(useResourcesList).toBeInstanceOf(Function);
    });

    it('should export MCP hooks', () => {
      expect(useMcp).toBeInstanceOf(Function);
      expect(useMcpAvailable).toBeInstanceOf(Function);
      expect(useMcpStatus).toBeInstanceOf(Function);
    });

    it('should export notification hooks', () => {
      expect(useNotifyAgent).toBeInstanceOf(Function);
      expect(useNavigationNotifier).toBeInstanceOf(Function);
      expect(useVisibilityNotifier).toBeInstanceOf(Function);
      expect(useFocusNotifier).toBeInstanceOf(Function);
    });

    it('should export page context hooks', () => {
      expect(usePageContext).toBeInstanceOf(Function);
      expect(usePageElement).toBeInstanceOf(Function);
    });

    it('should export component registration hooks', () => {
      expect(useRegisterComponent).toBeInstanceOf(Function);
      expect(useRegisteredComponents).toBeInstanceOf(Function);
      expect(useComponentSearch).toBeInstanceOf(Function);
      expect(useComponentsByCategory).toBeInstanceOf(Function);
      expect(useComponentsByTag).toBeInstanceOf(Function);
    });

    it('should export elicit hooks', () => {
      expect(useElicit).toBeInstanceOf(Function);
    });
  });

  describe('Component exports', () => {
    it('should export ElicitDialog', () => {
      expect(ElicitDialog).toBeInstanceOf(Function);
    });

    it('should export UIResourceRenderer', () => {
      expect(UIResourceRenderer).toBeInstanceOf(Function);
    });
  });
});

describe('PageElementTypes', () => {
  it('should have correct element types', () => {
    expect(PageElementTypes.FORM).toBe('form');
    expect(PageElementTypes.BUTTON).toBe('button');
    expect(PageElementTypes.INPUT).toBe('input');
    expect(PageElementTypes.TABLE).toBe('table');
    expect(PageElementTypes.LIST).toBe('list');
    expect(PageElementTypes.DIALOG).toBe('dialog');
    expect(PageElementTypes.CUSTOM).toBe('custom');
  });
});

describe('createFormElement', () => {
  it('should create a form element with required fields', () => {
    const element = createFormElement('LoginForm', ['username', 'password']);

    expect(element.type).toBe('form');
    expect(element.name).toBe('LoginForm');
    expect(element.fields).toEqual(['username', 'password']);
    expect(element.actions).toEqual(['submit', 'reset']);
  });

  it('should create a form element with custom actions', () => {
    const element = createFormElement('ContactForm', ['email', 'message'], {
      description: 'Contact us form',
      actions: ['send', 'cancel'],
      metadata: { version: 1 },
    });

    expect(element.description).toBe('Contact us form');
    expect(element.actions).toEqual(['send', 'cancel']);
    expect(element.metadata).toEqual({ version: 1 });
  });
});

describe('createTableElement', () => {
  it('should create a table element with columns', () => {
    const element = createTableElement('UsersTable', ['id', 'name', 'email']);

    expect(element.type).toBe('table');
    expect(element.name).toBe('UsersTable');
    expect(element.fields).toEqual(['id', 'name', 'email']);
    expect(element.actions).toEqual(['sort', 'filter']);
  });

  it('should create a table element with row count', () => {
    const element = createTableElement('DataTable', ['col1', 'col2'], {
      rowCount: 100,
      description: 'Data display table',
    });

    expect(element.description).toBe('Data display table');
    expect(element.metadata).toEqual({ rowCount: 100 });
  });
});

describe('createDialogElement', () => {
  it('should create a dialog element with defaults', () => {
    const element = createDialogElement('ConfirmDialog');

    expect(element.type).toBe('dialog');
    expect(element.name).toBe('ConfirmDialog');
    expect(element.actions).toEqual(['confirm', 'cancel']);
  });

  it('should create a dialog element with custom options', () => {
    const element = createDialogElement('EditDialog', {
      description: 'Edit item dialog',
      fields: ['title', 'content'],
      actions: ['save', 'delete', 'cancel'],
    });

    expect(element.description).toBe('Edit item dialog');
    expect(element.fields).toEqual(['title', 'content']);
    expect(element.actions).toEqual(['save', 'delete', 'cancel']);
  });
});

describe('formatElicitRequest', () => {
  it('should format a confirm request', () => {
    const request = {
      id: 'test-1',
      type: 'confirm' as const,
      message: 'Are you sure?',
    };

    const formatted = formatElicitRequest(request);

    expect(formatted.title).toBe('Confirmation');
    expect(formatted.message).toBe('Are you sure?');
    expect(formatted.type).toBe('confirm');
    expect(formatted.hasTimeout).toBe(false);
  });

  it('should format a select request', () => {
    const request = {
      id: 'test-2',
      type: 'select' as const,
      message: 'Choose an option',
      options: ['A', 'B', 'C'],
      timeout: 5000,
    };

    const formatted = formatElicitRequest(request);

    expect(formatted.title).toBe('Selection');
    expect(formatted.options).toEqual(['A', 'B', 'C']);
    expect(formatted.hasTimeout).toBe(true);
  });

  it('should format an input request', () => {
    const request = {
      id: 'test-3',
      type: 'input' as const,
      message: 'Enter a value',
    };

    const formatted = formatElicitRequest(request);

    expect(formatted.title).toBe('Input Required');
  });

  it('should format a form request', () => {
    const request = {
      id: 'test-4',
      type: 'form' as const,
      message: 'Fill the form',
    };

    const formatted = formatElicitRequest(request);

    expect(formatted.title).toBe('Form Input');
  });
});

describe('Elicit type guards', () => {
  const confirmRequest = { id: '1', type: 'confirm' as const, message: 'test' };
  const selectRequest = { id: '2', type: 'select' as const, message: 'test' };
  const inputRequest = { id: '3', type: 'input' as const, message: 'test' };
  const formRequest = { id: '4', type: 'form' as const, message: 'test' };

  it('should identify confirm requests', () => {
    expect(isConfirmRequest(confirmRequest)).toBe(true);
    expect(isConfirmRequest(selectRequest)).toBe(false);
  });

  it('should identify select requests', () => {
    expect(isSelectRequest(selectRequest)).toBe(true);
    expect(isSelectRequest(confirmRequest)).toBe(false);
  });

  it('should identify input requests', () => {
    expect(isInputRequest(inputRequest)).toBe(true);
    expect(isInputRequest(confirmRequest)).toBe(false);
  });

  it('should identify form requests', () => {
    expect(isFormRequest(formRequest)).toBe(true);
    expect(isFormRequest(confirmRequest)).toBe(false);
  });
});

describe('isUIResource', () => {
  it('should return true for valid UI resources', () => {
    const resource = {
      type: 'ui-resource',
      component: 'Button',
      props: { label: 'Click me' },
    };

    expect(isUIResource(resource)).toBe(true);
  });

  it('should return false for non-UI resources', () => {
    expect(isUIResource(null)).toBe(false);
    expect(isUIResource(undefined)).toBe(false);
    expect(isUIResource('string')).toBe(false);
    expect(isUIResource({ type: 'other' })).toBe(false);
    expect(isUIResource({ component: 'Button' })).toBe(false);
  });
});
