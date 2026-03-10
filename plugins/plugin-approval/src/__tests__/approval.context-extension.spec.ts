import 'reflect-metadata';

import { ApprovalServiceToken } from '../approval.symbols';

describe('installApprovalContextExtension', () => {
  it('should add approval getter to ExecutionContextBase.prototype', () => {
    const mockPrototype: Record<string, unknown> = {};

    jest.isolateModules(() => {
      jest.doMock('@frontmcp/sdk', () => ({
        ExecutionContextBase: {
          prototype: mockPrototype,
        },
      }));

      const { installApprovalContextExtension } = require('../approval.context-extension');
      installApprovalContextExtension();
    });

    // Use getOwnPropertyDescriptor to avoid triggering the getter
    const descriptor = Object.getOwnPropertyDescriptor(mockPrototype, 'approval');
    expect(descriptor).toBeDefined();
    expect(descriptor?.get).toBeDefined();
    expect(descriptor?.configurable).toBe(true);
    expect(descriptor?.enumerable).toBe(false);
  });

  it('should only install once (idempotent)', () => {
    const mockPrototype: Record<string, unknown> = {};
    let definePropertyCallCount = 0;

    const originalDefineProperty = Object.defineProperty;
    jest.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, descriptor) => {
      if (prop === 'approval') {
        definePropertyCallCount++;
      }
      return originalDefineProperty(obj, prop, descriptor);
    });

    try {
      jest.isolateModules(() => {
        jest.doMock('@frontmcp/sdk', () => ({
          ExecutionContextBase: {
            prototype: mockPrototype,
          },
        }));

        const { installApprovalContextExtension } = require('../approval.context-extension');

        // Install twice
        installApprovalContextExtension();
        installApprovalContextExtension();
      });

      // Should only have defined the property once
      expect(definePropertyCallCount).toBe(1);
      // Verify property was added (using getOwnPropertyDescriptor to avoid triggering getter)
      expect(Object.getOwnPropertyDescriptor(mockPrototype, 'approval')).toBeDefined();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('should return approval service when getter is called', () => {
    const mockPrototype: Record<string, unknown> = {};

    jest.isolateModules(() => {
      jest.doMock('@frontmcp/sdk', () => ({
        ExecutionContextBase: {
          prototype: mockPrototype,
        },
      }));

      const { installApprovalContextExtension } = require('../approval.context-extension');
      installApprovalContextExtension();
    });

    // Create a mock context with get method
    const mockApprovalService = { mockService: true };
    const mockContext = {
      get: (token: symbol) => {
        if (token === ApprovalServiceToken) {
          return mockApprovalService;
        }
        return undefined;
      },
    };

    // Get the approval property descriptor and call the getter
    const descriptor = Object.getOwnPropertyDescriptor(mockPrototype, 'approval');
    expect(descriptor?.get).toBeDefined();

    const result = descriptor!.get!.call(mockContext);
    expect(result).toBe(mockApprovalService);
  });
});
