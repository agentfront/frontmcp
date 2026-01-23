/**
 * Tests for elicitation fallback helpers.
 */
import type { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import type { Scope } from '../../../scope';
import { canDeliverNotifications } from '../fallback.helper';

// Mock Scope with notifications service
function createMockScope(clientCapabilities: ClientCapabilities | undefined): Scope {
  return {
    notifications: {
      getClientCapabilities: jest.fn().mockReturnValue(clientCapabilities),
    },
  } as unknown as Scope;
}

describe('canDeliverNotifications', () => {
  const sessionId = 'test-session-123';

  it('should return false when capabilities is undefined', () => {
    const scope = createMockScope(undefined);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(false);
  });

  it('should return false when capabilities is an empty object', () => {
    const scope = createMockScope({});

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(false);
  });

  it('should return false when capabilities has all undefined values', () => {
    // This is the key bug case: handler creates object with explicit keys but undefined values
    const capabilities: ClientCapabilities = {
      roots: undefined,
      sampling: undefined,
      experimental: undefined,
      elicitation: undefined,
    };
    const scope = createMockScope(capabilities);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(false);
  });

  it('should return true when capabilities has at least one defined value', () => {
    const capabilities: ClientCapabilities = {
      roots: { listChanged: true },
      sampling: undefined,
      experimental: undefined,
    };
    const scope = createMockScope(capabilities);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(true);
  });

  it('should return true when client supports sampling', () => {
    const capabilities: ClientCapabilities = {
      sampling: {},
    };
    const scope = createMockScope(capabilities);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(true);
  });

  it('should return true when client has experimental capabilities', () => {
    const capabilities: ClientCapabilities = {
      experimental: { customFeature: true },
    };
    const scope = createMockScope(capabilities);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(true);
  });

  it('should return true when client supports elicitation', () => {
    const capabilities: ClientCapabilities = {
      elicitation: {},
    };
    const scope = createMockScope(capabilities);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(true);
  });

  it('should return true when client has multiple defined capabilities', () => {
    const capabilities: ClientCapabilities = {
      roots: { listChanged: true },
      sampling: {},
      elicitation: {},
    };
    const scope = createMockScope(capabilities);

    const result = canDeliverNotifications(scope, sessionId);

    expect(result).toBe(true);
  });

  it('should call getClientCapabilities with the correct sessionId', () => {
    const scope = createMockScope(undefined);

    canDeliverNotifications(scope, sessionId);

    expect(scope.notifications.getClientCapabilities).toHaveBeenCalledWith(sessionId);
  });
});
