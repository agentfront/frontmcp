// file: libs/browser/src/react/components/ElicitDialog.tsx
/**
 * ElicitDialog component for human-in-the-loop interactions.
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

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ElicitRequest } from '../context';

/**
 * Props for ElicitDialog component.
 */
export interface ElicitDialogProps {
  /**
   * The elicit request from the AI agent.
   */
  request: ElicitRequest;

  /**
   * Callback when user responds to the request.
   */
  onRespond: (response: unknown) => void;

  /**
   * Callback when user dismisses the request.
   */
  onDismiss: () => void;

  /**
   * Custom class name for the dialog container.
   */
  className?: string;

  /**
   * Custom styles for the dialog container.
   */
  style?: React.CSSProperties;

  /**
   * Custom labels for buttons.
   */
  labels?: {
    confirm?: string;
    cancel?: string;
    submit?: string;
    dismiss?: string;
  };
}

/**
 * Default styles for the dialog.
 */
const defaultStyles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  dialog: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '400px',
    width: '90%',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600 as const,
    marginBottom: '12px',
    color: '#1a1a1a',
  },
  message: {
    fontSize: '14px',
    color: '#4a4a4a',
    marginBottom: '20px',
    lineHeight: 1.5,
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '4px',
    border: 'none',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  primaryButton: {
    backgroundColor: '#0066cc',
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: '#e0e0e0',
    color: '#333',
  },
  optionButton: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    marginBottom: '8px',
    textAlign: 'left' as const,
    backgroundColor: '#f5f5f5',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    marginBottom: '16px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
  },
};

/**
 * Get the dialog title based on request type.
 */
function getTitle(request: ElicitRequest): string {
  switch (request.type) {
    case 'confirm':
      return 'Confirmation Required';
    case 'select':
      return 'Please Select';
    case 'input':
      return 'Input Required';
    case 'form':
      return 'Form Input Required';
    default:
      return 'Request';
  }
}

/**
 * ElicitDialog component.
 *
 * Renders a dialog for human-in-the-loop interactions.
 * Supports confirmation, selection, input, and form request types.
 */
export function ElicitDialog({
  request,
  onRespond,
  onDismiss,
  className,
  style,
  labels = {},
}: ElicitDialogProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount for input types
  useEffect(() => {
    if (request.type === 'input' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [request.type]);

  // Handle confirmation response
  const handleConfirm = useCallback(() => {
    onRespond(true);
  }, [onRespond]);

  const handleCancel = useCallback(() => {
    onRespond(false);
  }, [onRespond]);

  // Handle selection response
  const handleSelect = useCallback(
    (option: string) => {
      setSelectedOption(option);
      onRespond(option);
    },
    [onRespond],
  );

  // Handle input response
  const handleInputSubmit = useCallback(() => {
    onRespond(inputValue);
  }, [onRespond, inputValue]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleInputSubmit();
      }
    },
    [handleInputSubmit],
  );

  // Render dialog content based on type
  const renderContent = (): React.ReactElement => {
    switch (request.type) {
      case 'confirm':
        return (
          <div style={defaultStyles.buttonGroup}>
            <button style={{ ...defaultStyles.button, ...defaultStyles.secondaryButton }} onClick={handleCancel}>
              {labels.cancel ?? 'Cancel'}
            </button>
            <button style={{ ...defaultStyles.button, ...defaultStyles.primaryButton }} onClick={handleConfirm}>
              {labels.confirm ?? 'Confirm'}
            </button>
          </div>
        );

      case 'select':
        return (
          <div>
            {request.options?.map((option) => (
              <button
                key={option}
                style={{
                  ...defaultStyles.optionButton,
                  backgroundColor: selectedOption === option ? '#e3f2fd' : '#f5f5f5',
                  borderColor: selectedOption === option ? '#0066cc' : '#ddd',
                }}
                onClick={() => handleSelect(option)}
              >
                {option}
              </button>
            ))}
            <div style={defaultStyles.buttonGroup}>
              <button style={{ ...defaultStyles.button, ...defaultStyles.secondaryButton }} onClick={onDismiss}>
                {labels.dismiss ?? 'Dismiss'}
              </button>
            </div>
          </div>
        );

      case 'input':
        return (
          <div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              style={defaultStyles.input}
              placeholder="Enter your response..."
            />
            <div style={defaultStyles.buttonGroup}>
              <button style={{ ...defaultStyles.button, ...defaultStyles.secondaryButton }} onClick={onDismiss}>
                {labels.dismiss ?? 'Cancel'}
              </button>
              <button style={{ ...defaultStyles.button, ...defaultStyles.primaryButton }} onClick={handleInputSubmit}>
                {labels.submit ?? 'Submit'}
              </button>
            </div>
          </div>
        );

      case 'form':
        // Form type would need a more complex implementation
        // For now, treat it like input
        return (
          <div>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              style={defaultStyles.input}
              placeholder="Enter your response..."
            />
            <div style={defaultStyles.buttonGroup}>
              <button style={{ ...defaultStyles.button, ...defaultStyles.secondaryButton }} onClick={onDismiss}>
                {labels.dismiss ?? 'Cancel'}
              </button>
              <button style={{ ...defaultStyles.button, ...defaultStyles.primaryButton }} onClick={handleInputSubmit}>
                {labels.submit ?? 'Submit'}
              </button>
            </div>
          </div>
        );

      default:
        return (
          <div style={defaultStyles.buttonGroup}>
            <button style={{ ...defaultStyles.button, ...defaultStyles.secondaryButton }} onClick={onDismiss}>
              {labels.dismiss ?? 'Close'}
            </button>
          </div>
        );
    }
  };

  return (
    <div style={defaultStyles.overlay} className={className}>
      <div style={{ ...defaultStyles.dialog, ...style }} role="dialog" aria-modal="true">
        <div style={defaultStyles.title}>{getTitle(request)}</div>
        <div style={defaultStyles.message}>{request.message}</div>
        {renderContent()}
      </div>
    </div>
  );
}
