// file: libs/browser/src/react/context/HitlContext.tsx
/**
 * Human-in-the-Loop React Context
 *
 * Provides HiTL functionality throughout the React component tree,
 * managing confirmation dialogs, audit logging, and remembered decisions.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { BrowserHitlManager, createBrowserHitlManager } from '../../hitl';
import type {
  HitlContextValue,
  HitlProviderProps,
  ConfirmationDialogProps,
  BrowserHitlManagerOptions,
  ConfirmationRequest,
  ConfirmationResponse,
  ConfirmationDecision,
  RiskLevel,
  AuditLogEntry,
  RememberedDecision,
} from '../../hitl';

/**
 * Default context value (not configured)
 */
const defaultContextValue: HitlContextValue = {
  requestConfirmation: () => {
    throw new Error('HitlProvider not found');
  },
  requiresConfirmation: () => false,
  getAuditLog: () => [],
  clearAuditLog: () => {
    throw new Error('HitlProvider not found');
  },
  getRememberedDecisions: () => [],
  forgetDecision: () => {
    throw new Error('HitlProvider not found');
  },
  forgetAllDecisions: () => {
    throw new Error('HitlProvider not found');
  },
  isEnabled: false,
  pendingRequest: null,
};

/**
 * HiTL React Context
 */
export const HitlContext = createContext<HitlContextValue>(defaultContextValue);

/**
 * Default Confirmation Dialog Component
 */
const DefaultConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  request,
  onDecision,
  options = {},
  isOpen = true,
}) => {
  const [remember, setRemember] = useState(false);
  const [reason, setReason] = useState('');

  if (!isOpen) {
    return null;
  }

  const {
    title = 'Confirmation Required',
    showArguments = true,
    showRiskLevel = true,
    className = '',
    displayMode = 'modal',
    zIndex = 9999,
    theme = 'system',
    buttons = {},
  } = options;

  const riskColors: Record<RiskLevel, string> = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#f97316',
    critical: '#ef4444',
  };

  const handleApprove = () => {
    onDecision('approve', remember, reason || undefined);
  };

  const handleDeny = () => {
    onDecision('deny', remember, reason || undefined);
  };

  const handleDismiss = () => {
    onDecision('dismiss', false);
  };

  const dialogStyle: React.CSSProperties = {
    position: displayMode === 'modal' ? 'fixed' : 'relative',
    top: displayMode === 'modal' ? '50%' : undefined,
    left: displayMode === 'modal' ? '50%' : undefined,
    transform: displayMode === 'modal' ? 'translate(-50%, -50%)' : undefined,
    zIndex: displayMode === 'modal' ? zIndex : undefined,
    backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
    color: theme === 'dark' ? '#f3f4f6' : '#111827',
    border: `1px solid ${riskColors[request.riskLevel]}`,
    borderRadius: '8px',
    padding: '20px',
    minWidth: '400px',
    maxWidth: '600px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  };

  const overlayStyle: React.CSSProperties =
    displayMode === 'modal'
      ? {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: zIndex - 1,
        }
      : {};

  return (
    <>
      {displayMode === 'modal' && <div style={overlayStyle} onClick={handleDismiss} />}
      <div
        className={`hitl-dialog ${className}`}
        style={dialogStyle}
        role="dialog"
        aria-modal={displayMode === 'modal'}
        aria-labelledby="hitl-dialog-title"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 id="hitl-dialog-title" style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            {title}
          </h2>
          {showRiskLevel && (
            <span
              style={{
                backgroundColor: riskColors[request.riskLevel],
                color: 'white',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 500,
                textTransform: 'uppercase',
              }}
            >
              {request.riskLevel}
            </span>
          )}
        </div>

        <p style={{ marginBottom: '16px' }}>{request.description}</p>

        {request.context && (
          <p style={{ marginBottom: '16px', fontStyle: 'italic', opacity: 0.8 }}>{request.context}</p>
        )}

        {showArguments && request.arguments && Object.keys(request.arguments).length > 0 && (
          <div
            style={{
              backgroundColor: theme === 'dark' ? '#374151' : '#f3f4f6',
              padding: '12px',
              borderRadius: '4px',
              marginBottom: '16px',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          >
            <strong>Arguments:</strong>
            <pre style={{ margin: '8px 0 0 0', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(request.arguments, null, 2)}
            </pre>
          </div>
        )}

        {request.allowRemember && (
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ marginRight: '8px' }}
            />
            {buttons.remember ?? 'Remember my choice for this action'}
          </label>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={handleDeny}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: '1px solid #6b7280',
              backgroundColor: 'transparent',
              color: theme === 'dark' ? '#f3f4f6' : '#374151',
              cursor: 'pointer',
            }}
          >
            {buttons.deny ?? request.denyText ?? 'Deny'}
          </button>
          <button
            onClick={handleApprove}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: riskColors[request.riskLevel],
              color: 'white',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {buttons.approve ?? request.approveText ?? 'Approve'}
          </button>
        </div>
      </div>
    </>
  );
};

/**
 * HiTL Provider Component
 *
 * Wraps the application to provide HiTL functionality including:
 * - Confirmation dialogs for tool execution
 * - Audit logging
 * - Remembered decisions
 *
 * @example
 * ```tsx
 * import { HitlProvider } from '@frontmcp/browser/react';
 *
 * function App() {
 *   return (
 *     <HitlProvider options={{ debug: true }}>
 *       <MyApp />
 *     </HitlProvider>
 *   );
 * }
 * ```
 */
export const HitlProvider: React.FC<HitlProviderProps> = ({
  children,
  options = {},
  DialogComponent = DefaultConfirmationDialog,
}) => {
  const [manager] = useState(() => createBrowserHitlManager(options));
  const [pendingRequest, setPendingRequest] = useState<ConfirmationRequest | null>(null);

  // Connect manager to React state
  useEffect(() => {
    manager.setOnRequestChange(setPendingRequest);
    return () => {
      manager.setOnRequestChange(null);
    };
  }, [manager]);

  const requestConfirmation = useCallback(
    (
      actionName: string,
      opts: {
        description: string;
        riskLevel?: RiskLevel;
        arguments?: Record<string, unknown>;
        timeout?: number;
        allowRemember?: boolean;
        context?: string;
      },
    ): Promise<ConfirmationResponse> => {
      return manager.requestConfirmation(actionName, opts);
    },
    [manager],
  );

  const requiresConfirmation = useCallback(
    (actionName: string, riskLevel?: RiskLevel): boolean => {
      return manager.requiresConfirmation(actionName, riskLevel);
    },
    [manager],
  );

  const getAuditLog = useCallback((): AuditLogEntry[] => {
    return manager.getAuditLog();
  }, [manager]);

  const clearAuditLog = useCallback((): void => {
    manager.clearAuditLog();
  }, [manager]);

  const getRememberedDecisions = useCallback((): RememberedDecision[] => {
    return manager.getRememberedDecisions();
  }, [manager]);

  const forgetDecision = useCallback(
    (actionName: string): void => {
      manager.forgetDecision(actionName);
    },
    [manager],
  );

  const forgetAllDecisions = useCallback((): void => {
    manager.forgetAllDecisions();
  }, [manager]);

  const handleDecision = useCallback(
    (decision: ConfirmationDecision, remember: boolean, reason?: string): void => {
      manager.resolveDialog(decision, remember, reason);
    },
    [manager],
  );

  const contextValue: HitlContextValue = useMemo(
    () => ({
      requestConfirmation,
      requiresConfirmation,
      getAuditLog,
      clearAuditLog,
      getRememberedDecisions,
      forgetDecision,
      forgetAllDecisions,
      isEnabled: manager.isEnabled(),
      pendingRequest,
    }),
    [
      requestConfirmation,
      requiresConfirmation,
      getAuditLog,
      clearAuditLog,
      getRememberedDecisions,
      forgetDecision,
      forgetAllDecisions,
      manager,
      pendingRequest,
    ],
  );

  return (
    <HitlContext.Provider value={contextValue}>
      {children}
      {pendingRequest && (
        <DialogComponent
          request={pendingRequest}
          onDecision={handleDecision}
          options={manager.getDialogOptions()}
          isOpen={true}
        />
      )}
    </HitlContext.Provider>
  );
};

/**
 * Hook to access the HiTL context.
 *
 * @throws Error if used outside of HitlProvider
 *
 * @example
 * ```tsx
 * function MyTool() {
 *   const { requestConfirmation } = useHitl();
 *
 *   const handleDelete = async () => {
 *     const response = await requestConfirmation('delete-item', {
 *       description: 'Delete this item?',
 *       riskLevel: 'high',
 *     });
 *
 *     if (response.decision === 'approve') {
 *       // Proceed with deletion
 *     }
 *   };
 *
 *   return <button onClick={handleDelete}>Delete</button>;
 * }
 * ```
 */
export function useHitl(): HitlContextValue {
  const context = useContext(HitlContext);
  if (context === defaultContextValue) {
    throw new Error('useHitl must be used within a HitlProvider');
  }
  return context;
}
