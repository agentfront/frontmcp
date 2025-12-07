/**
 * @file tools.tsx
 * @description React hooks for MCP tool interactions.
 *
 * Provides hooks for calling tools, accessing tool input/output,
 * and managing tool execution state.
 *
 * @example
 * ```tsx
 * import { useCallTool, useToolInput, useToolOutput } from '@frontmcp/ui/react';
 *
 * function WeatherWidget() {
 *   const input = useToolInput<{ location: string }>();
 *   const output = useToolOutput<WeatherData>();
 *   const [callWeather, { data, loading, error }] = useCallTool<WeatherData>('get_weather');
 *
 *   return (
 *     <div>
 *       <p>Location: {input?.location}</p>
 *       <button onClick={() => callWeather({ location: 'NYC' })}>
 *         Get Weather
 *       </button>
 *       {loading && <p>Loading...</p>}
 *       {data && <p>Temperature: {data.temperature}</p>}
 *     </div>
 *   );
 * }
 * ```
 *
 * @module @frontmcp/ui/react/hooks
 */

import { useState, useCallback, useEffect } from 'react';
import { useMcpBridgeContext, useMcpBridge } from './context';

// ============================================
// Types
// ============================================

/**
 * State for tool execution.
 */
export interface ToolState<T = unknown> {
  /** Tool result data */
  data: T | null;
  /** Whether the tool is currently executing */
  loading: boolean;
  /** Execution error, if any */
  error: Error | null;
  /** Whether the tool has been called at least once */
  called: boolean;
}

/**
 * Options for useCallTool hook.
 */
export interface UseCallToolOptions {
  /** Automatically reset state when tool name changes */
  resetOnToolChange?: boolean;
  /** Callback when tool execution succeeds */
  onSuccess?: (data: unknown) => void;
  /** Callback when tool execution fails */
  onError?: (error: Error) => void;
}

/**
 * Return type for useCallTool hook.
 */
export type UseCallToolReturn<TInput extends object, TOutput> = [
  /** Function to call the tool */
  (args: TInput) => Promise<TOutput | null>,
  /** Current tool state */
  ToolState<TOutput>,
  /** Reset state to initial values */
  () => void,
];

// ============================================
// Tool Input/Output Hooks
// ============================================

/**
 * Hook to get the current tool input arguments.
 * Returns the arguments passed to the tool when it was invoked.
 *
 * @typeParam T - Expected shape of the tool input
 *
 * @example
 * ```tsx
 * interface WeatherInput {
 *   location: string;
 *   units?: 'celsius' | 'fahrenheit';
 * }
 *
 * function WeatherWidget() {
 *   const input = useToolInput<WeatherInput>();
 *
 *   return (
 *     <div>
 *       <h1>Weather for {input?.location}</h1>
 *       <p>Units: {input?.units ?? 'celsius'}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useToolInput<T extends object = Record<string, unknown>>(): T | null {
  const { bridge, ready } = useMcpBridgeContext();

  if (!ready || !bridge) {
    return null;
  }

  try {
    return bridge.getToolInput() as T;
  } catch {
    return null;
  }
}

/**
 * Hook to get the current tool output/result.
 * Returns the result data from the tool execution.
 *
 * @typeParam T - Expected shape of the tool output
 *
 * @example
 * ```tsx
 * interface WeatherOutput {
 *   temperature: number;
 *   condition: string;
 *   humidity: number;
 * }
 *
 * function WeatherDisplay() {
 *   const output = useToolOutput<WeatherOutput>();
 *
 *   if (!output) return <div>No data</div>;
 *
 *   return (
 *     <div>
 *       <p>Temperature: {output.temperature}°</p>
 *       <p>Condition: {output.condition}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useToolOutput<T = unknown>(): T | null {
  const { bridge, ready } = useMcpBridgeContext();
  const [output, setOutput] = useState<T | null>(null);

  useEffect(() => {
    if (!ready || !bridge) return;

    // Get initial output
    try {
      const initialOutput = bridge.getToolOutput();
      if (initialOutput !== undefined) {
        setOutput(initialOutput as T);
      }
    } catch {
      // Ignore
    }

    // Subscribe to tool result updates
    const unsubscribe = bridge.onToolResult((result) => {
      setOutput(result as T);
    });

    return unsubscribe;
  }, [bridge, ready]);

  return output;
}

/**
 * Hook to get the structured content from the tool output.
 * This is the parsed/structured version of the tool result.
 *
 * @typeParam T - Expected shape of the structured content
 *
 * @example
 * ```tsx
 * interface WeatherData {
 *   forecast: Array<{ day: string; temp: number }>;
 * }
 *
 * function ForecastDisplay() {
 *   const content = useStructuredContent<WeatherData>();
 *
 *   return (
 *     <ul>
 *       {content?.forecast.map(day => (
 *         <li key={day.day}>{day.day}: {day.temp}°</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useStructuredContent<T = unknown>(): T | null {
  const { bridge, ready } = useMcpBridgeContext();

  if (!ready || !bridge) {
    return null;
  }

  try {
    const adapter = bridge.getAdapter?.();
    if (adapter) {
      return adapter.getStructuredContent() as T;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================
// Tool Execution Hooks
// ============================================

/**
 * Hook to call an MCP tool with loading and error state management.
 *
 * Returns a tuple with:
 * 1. The call function
 * 2. State object (data, loading, error, called)
 * 3. Reset function
 *
 * @typeParam TInput - Shape of the tool input arguments
 * @typeParam TOutput - Expected shape of the tool output
 *
 * @example Basic usage
 * ```tsx
 * function WeatherButton() {
 *   const [getWeather, { data, loading, error }] = useCallTool<
 *     { location: string },
 *     { temperature: number; condition: string }
 *   >('get_weather');
 *
 *   return (
 *     <div>
 *       <button
 *         onClick={() => getWeather({ location: 'San Francisco' })}
 *         disabled={loading}
 *       >
 *         {loading ? 'Loading...' : 'Get Weather'}
 *       </button>
 *       {error && <p className="error">{error.message}</p>}
 *       {data && <p>{data.temperature}° - {data.condition}</p>}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example With callbacks
 * ```tsx
 * function WeatherWidget() {
 *   const [getWeather, state, reset] = useCallTool('get_weather', {
 *     onSuccess: (data) => console.log('Got weather:', data),
 *     onError: (err) => console.error('Failed:', err),
 *   });
 *
 *   return (
 *     <div>
 *       <button onClick={() => getWeather({ location: 'NYC' })}>
 *         Get Weather
 *       </button>
 *       <button onClick={reset}>Reset</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCallTool<TInput extends object = Record<string, unknown>, TOutput = unknown>(
  toolName: string,
  options: UseCallToolOptions = {},
): UseCallToolReturn<TInput, TOutput> {
  const { bridge, ready } = useMcpBridgeContext();
  const { onSuccess, onError, resetOnToolChange = true } = options;

  console.log('useCallTool', toolName, bridge);
  const [state, setState] = useState<ToolState<TOutput>>({
    data: null,
    loading: false,
    error: null,
    called: false,
  });

  // Reset state when tool name changes
  useEffect(() => {
    if (resetOnToolChange) {
      setState({
        data: null,
        loading: false,
        error: null,
        called: false,
      });
    }
  }, [toolName, resetOnToolChange]);

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
      called: false,
    });
  }, []);

  const callTool = useCallback(
    async (args: TInput): Promise<TOutput | null> => {
      if (!ready || !bridge) {
        const error = new Error('Bridge not initialized');
        setState((prev) => ({ ...prev, error, called: true }));
        onError?.(error);
        return null;
      }

      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        called: true,
      }));

      try {
        const result = await bridge.callTool(toolName, args as Record<string, unknown>);
        const data = result as TOutput;

        setState({
          data,
          loading: false,
          error: null,
          called: true,
        });

        onSuccess?.(data);
        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        setState({
          data: null,
          loading: false,
          error,
          called: true,
        });

        onError?.(error);
        return null;
      }
    },
    [bridge, ready, toolName, onSuccess, onError],
  );

  return [callTool, state, reset];
}

/**
 * Hook to manage multiple tool calls.
 * Useful when you need to track state for multiple tools.
 *
 * @example
 * ```tsx
 * function MultiToolWidget() {
 *   const tools = useToolCalls({
 *     weather: 'get_weather',
 *     news: 'get_news',
 *     stocks: 'get_stocks',
 *   });
 *
 *   return (
 *     <div>
 *       <button onClick={() => tools.weather.call({ location: 'NYC' })}>
 *         Get Weather
 *       </button>
 *       <button onClick={() => tools.news.call({ topic: 'tech' })}>
 *         Get News
 *       </button>
 *       {tools.weather.loading && <p>Loading weather...</p>}
 *       {tools.news.data && <p>News: {tools.news.data.headline}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useToolCalls<T extends Record<string, string>>(
  toolMap: T,
): {
  [K in keyof T]: {
    call: (args: Record<string, unknown>) => Promise<unknown>;
    data: unknown;
    loading: boolean;
    error: Error | null;
    reset: () => void;
  };
} {
  const bridge = useMcpBridge();
  const [states, setStates] = useState<Record<string, ToolState<unknown>>>(() => {
    const initial: Record<string, ToolState<unknown>> = {};
    for (const key of Object.keys(toolMap)) {
      initial[key] = { data: null, loading: false, error: null, called: false };
    }
    return initial;
  });

  const createCallFn = useCallback(
    (key: string, toolName: string) =>
      async (args: Record<string, unknown>): Promise<unknown> => {
        if (!bridge) {
          setStates((prev) => ({
            ...prev,
            [key]: {
              ...prev[key],
              error: new Error('Bridge not initialized'),
              called: true,
            },
          }));
          return null;
        }

        setStates((prev) => ({
          ...prev,
          [key]: { ...prev[key], loading: true, error: null, called: true },
        }));

        try {
          const result = await bridge.callTool(toolName, args);
          setStates((prev) => ({
            ...prev,
            [key]: { data: result, loading: false, error: null, called: true },
          }));
          return result;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          setStates((prev) => ({
            ...prev,
            [key]: { data: null, loading: false, error, called: true },
          }));
          return null;
        }
      },
    [bridge],
  );

  const createResetFn = useCallback(
    (key: string) => () => {
      setStates((prev) => ({
        ...prev,
        [key]: { data: null, loading: false, error: null, called: false },
      }));
    },
    [],
  );

  // Build result object
  const result = {} as {
    [K in keyof T]: {
      call: (args: Record<string, unknown>) => Promise<unknown>;
      data: unknown;
      loading: boolean;
      error: Error | null;
      reset: () => void;
    };
  };

  for (const [key, toolName] of Object.entries(toolMap)) {
    const state = states[key] || {
      data: null,
      loading: false,
      error: null,
      called: false,
    };
    result[key as keyof T] = {
      call: createCallFn(key, toolName),
      data: state.data,
      loading: state.loading,
      error: state.error,
      reset: createResetFn(key),
    };
  }

  return result;
}

/**
 * Hook to send a message to the conversation.
 * Returns a function and state for sending messages.
 *
 * @example
 * ```tsx
 * function ChatWidget() {
 *   const [sendMessage, { loading, error, sent }] = useSendMessage();
 *
 *   return (
 *     <button
 *       onClick={() => sendMessage('Here is the weather update!')}
 *       disabled={loading}
 *     >
 *       {loading ? 'Sending...' : 'Send Update'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useSendMessage(): [
  (content: string) => Promise<void>,
  { loading: boolean; error: Error | null; sent: boolean },
] {
  const bridge = useMcpBridge();
  const [state, setState] = useState({
    loading: false,
    error: null as Error | null,
    sent: false,
  });

  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      if (!bridge) {
        setState({ loading: false, error: new Error('Bridge not initialized'), sent: false });
        return;
      }

      setState({ loading: true, error: null, sent: false });

      try {
        await bridge.sendMessage(content);
        setState({ loading: false, error: null, sent: true });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ loading: false, error, sent: false });
      }
    },
    [bridge],
  );

  return [sendMessage, state];
}

/**
 * Hook to open external links via the bridge.
 *
 * @example
 * ```tsx
 * function LinkButton() {
 *   const openLink = useOpenLink();
 *
 *   return (
 *     <button onClick={() => openLink('https://example.com')}>
 *       Open Website
 *     </button>
 *   );
 * }
 * ```
 */
export function useOpenLink(): (url: string) => Promise<void> {
  const bridge = useMcpBridge();

  return useCallback(
    async (url: string): Promise<void> => {
      if (!bridge) {
        console.warn('Bridge not initialized, cannot open link');
        return;
      }

      await bridge.openLink(url);
    },
    [bridge],
  );
}
