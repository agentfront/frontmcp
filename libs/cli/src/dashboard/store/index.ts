/**
 * Dashboard Store - State management for the dev dashboard
 *
 * Simple implementation using a class with listeners pattern.
 * Can be used with React via useSyncExternalStore.
 */

import { randomUUID } from 'crypto';
import type {
  DevEvent,
  SessionEvent,
  RequestEvent,
  RegistryEvent,
  ServerEvent,
  ScopeGraphEvent,
  ConfigEvent,
} from '../events/types.js';
import type {
  DashboardState,
  DashboardActions,
  DashboardStore,
  TabName,
  LogLevel,
  SessionInfo,
  RequestInfo,
  LogEntry,
  ServerStatus,
  WatchStatus,
  TypeCheckStatus,
  PanelFocus,
  RightPanelTab,
  ScrollState,
  SearchState,
} from './types.js';
import { initialDashboardState, TAB_LIST, RIGHT_PANEL_TABS, initialScrollState, initialSearchState } from './types.js';

// Max items to keep in collections
const MAX_REQUESTS = 500;
const MAX_LOGS = 1000;

type Listener = () => void;

/**
 * Create a dashboard store instance.
 *
 * @example
 * ```typescript
 * const store = createDashboardStore();
 *
 * // Subscribe to changes
 * const unsubscribe = store.subscribe(() => {
 *   console.log('State changed:', store.getState());
 * });
 *
 * // Update state
 * store.setActiveTab('sessions');
 *
 * // Handle events
 * store.handleEvent(event);
 * ```
 */
export function createDashboardStore(): DashboardStore & {
  subscribe: (listener: Listener) => () => void;
  getState: () => DashboardState;
} {
  // Internal state
  let state: DashboardState = { ...initialDashboardState, sessions: new Map() };
  const listeners = new Set<Listener>();

  // Notify all listeners
  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  // Update state and notify
  const setState = (partial: Partial<DashboardState>) => {
    state = { ...state, ...partial };
    notify();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  const setActiveTab = (tab: TabName) => {
    if (TAB_LIST.includes(tab)) {
      setState({ activeTab: tab });
    }
  };

  const selectSession = (id: string | null) => {
    setState({ selectedSessionId: id });
  };

  const selectRequest = (id: string | null) => {
    setState({ selectedRequestId: id });
  };

  const handleLog = (level: LogLevel, message: string, source?: string) => {
    const log: LogEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      level,
      message,
      source,
    };

    const logs = [...state.logs, log];
    if (logs.length > MAX_LOGS) {
      logs.splice(0, logs.length - MAX_LOGS);
    }

    // Auto-scroll to bottom if autoScroll is enabled for logs tab
    const logsScrollState = state.scrollStates.logs;
    if (logsScrollState.autoScroll) {
      const newOffset = Math.max(0, logs.length - logsScrollState.viewportHeight);
      const newSelectedIndex = logs.length - 1;
      setState({
        logs,
        scrollStates: {
          ...state.scrollStates,
          logs: {
            ...logsScrollState,
            offset: newOffset,
            selectedIndex: newSelectedIndex,
          },
        },
      });
    } else {
      setState({ logs });
    }
  };

  const setConnectionStatus = (status: 'disconnected' | 'connecting' | 'connected') => {
    setState({ connectionStatus: status });
  };

  const setConnectionMode = (mode: 'ipc' | 'stderr' | 'none') => {
    setState({ connectionMode: mode });
  };

  const setWatchStatus = (status: WatchStatus) => {
    setState({ watchStatus: status });
  };

  const setTypeCheckStatus = (status: TypeCheckStatus) => {
    setState({ typeCheckStatus: status });
  };

  const clearLogs = () => {
    setState({ logs: [] });
  };

  const clearRequests = () => {
    setState({ requests: [] });
  };

  const reset = () => {
    state = { ...initialDashboardState, sessions: new Map() };
    notify();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // New Navigation Actions (Two-Panel Layout)
  // ─────────────────────────────────────────────────────────────────────────

  const setFocus = (panel: PanelFocus) => {
    setState({ panelFocus: panel });
  };

  const setRightPanelTab = (tab: RightPanelTab) => {
    if (RIGHT_PANEL_TABS.includes(tab)) {
      setState({ rightPanelTab: tab });
    }
  };

  const toggleFocus = () => {
    setState({ panelFocus: state.panelFocus === 'left' ? 'right' : 'left' });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Scroll Actions
  // ─────────────────────────────────────────────────────────────────────────

  const getItemCount = (): number => {
    switch (state.rightPanelTab) {
      case 'logs':
        return state.logs.length;
      case 'sessions':
        return state.sessions.size;
      case 'tools':
      case 'api':
        return state.requests.length;
      case 'config':
        return 1; // Config is not scrollable
      default:
        return 0;
    }
  };

  const updateScrollState = (updater: (scroll: ScrollState) => Partial<ScrollState>) => {
    const tab = state.rightPanelTab;
    const currentScroll = state.scrollStates[tab];
    const updates = updater(currentScroll);
    const newScroll = { ...currentScroll, ...updates };

    // Clamp values
    const itemCount = getItemCount();
    newScroll.selectedIndex = Math.max(0, Math.min(newScroll.selectedIndex, itemCount - 1));
    newScroll.offset = Math.max(0, Math.min(newScroll.offset, Math.max(0, itemCount - newScroll.viewportHeight)));

    // Keep selected item visible
    if (newScroll.selectedIndex < newScroll.offset) {
      newScroll.offset = newScroll.selectedIndex;
    } else if (newScroll.selectedIndex >= newScroll.offset + newScroll.viewportHeight) {
      newScroll.offset = newScroll.selectedIndex - newScroll.viewportHeight + 1;
    }

    setState({
      scrollStates: {
        ...state.scrollStates,
        [tab]: newScroll,
      },
    });
  };

  const scrollUp = () => {
    // Disable auto-scroll when user scrolls up
    updateScrollState((scroll) => ({
      selectedIndex: scroll.selectedIndex - 1,
      autoScroll: false,
    }));
  };

  const scrollDown = () => {
    const itemCount = getItemCount();
    const tab = state.rightPanelTab;
    const currentScroll = state.scrollStates[tab];
    // Enable auto-scroll if we're scrolling to the last item
    const willBeAtBottom = currentScroll.selectedIndex + 1 >= itemCount - 1;
    updateScrollState((scroll) => ({
      selectedIndex: scroll.selectedIndex + 1,
      autoScroll: willBeAtBottom,
    }));
  };

  const pageUp = () => {
    // Disable auto-scroll when user scrolls up
    updateScrollState((scroll) => {
      const halfPage = Math.floor(scroll.viewportHeight / 2);
      return {
        selectedIndex: scroll.selectedIndex - halfPage,
        offset: scroll.offset - halfPage,
        autoScroll: false,
      };
    });
  };

  const pageDown = () => {
    const itemCount = getItemCount();
    const tab = state.rightPanelTab;
    const currentScroll = state.scrollStates[tab];
    const halfPage = Math.floor(currentScroll.viewportHeight / 2);
    // Enable auto-scroll if we're scrolling to near the bottom
    const willBeAtBottom = currentScroll.selectedIndex + halfPage >= itemCount - 1;
    updateScrollState((scroll) => ({
      selectedIndex: scroll.selectedIndex + halfPage,
      offset: scroll.offset + halfPage,
      autoScroll: willBeAtBottom,
    }));
  };

  const scrollToTop = () => {
    // Disable auto-scroll when going to top
    updateScrollState(() => ({
      selectedIndex: 0,
      offset: 0,
      autoScroll: false,
    }));
  };

  const scrollToBottom = () => {
    // Enable auto-scroll when going to bottom
    const itemCount = getItemCount();
    updateScrollState((scroll) => ({
      selectedIndex: Math.max(0, itemCount - 1),
      offset: Math.max(0, itemCount - scroll.viewportHeight),
      autoScroll: true,
    }));
  };

  const setViewportHeight = (tab: RightPanelTab, height: number) => {
    setState({
      scrollStates: {
        ...state.scrollStates,
        [tab]: {
          ...state.scrollStates[tab],
          viewportHeight: height,
        },
      },
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Search Actions
  // ─────────────────────────────────────────────────────────────────────────

  const startSearch = () => {
    setState({
      searchState: {
        active: true,
        query: '',
        matchingIds: [],
        currentIndex: -1,
      },
    });
  };

  const updateSearchQuery = (query: string) => {
    // Find matching log IDs
    const matchingIds = state.logs
      .filter(
        (log) =>
          log.message.toLowerCase().includes(query.toLowerCase()) ||
          log.source?.toLowerCase().includes(query.toLowerCase()),
      )
      .map((log) => log.id);

    setState({
      searchState: {
        ...state.searchState,
        query,
        matchingIds,
        currentIndex: matchingIds.length > 0 ? 0 : -1,
      },
    });
  };

  const nextSearchResult = () => {
    const { matchingIds, currentIndex } = state.searchState;
    if (matchingIds.length === 0) return;

    const nextIndex = (currentIndex + 1) % matchingIds.length;
    setState({
      searchState: {
        ...state.searchState,
        currentIndex: nextIndex,
      },
    });
  };

  const prevSearchResult = () => {
    const { matchingIds, currentIndex } = state.searchState;
    if (matchingIds.length === 0) return;

    const prevIndex = currentIndex <= 0 ? matchingIds.length - 1 : currentIndex - 1;
    setState({
      searchState: {
        ...state.searchState,
        currentIndex: prevIndex,
      },
    });
  };

  const endSearch = () => {
    setState({
      searchState: { ...initialSearchState },
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Help & Terminal Size Actions
  // ─────────────────────────────────────────────────────────────────────────

  const toggleHelp = () => {
    setState({ showHelp: !state.showHelp });
  };

  const setTerminalSize = (width: number, height: number) => {
    setState({ terminalWidth: width, terminalHeight: height });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Event Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleSessionEvent = (event: SessionEvent) => {
    const sessions = new Map(state.sessions);
    const { sessionId } = event.data;

    switch (event.type) {
      case 'session:connect': {
        sessions.set(sessionId, {
          id: sessionId,
          createdAt: event.timestamp,
          lastActivityAt: event.timestamp,
          clientInfo: event.data.clientInfo,
          platformType: event.data.platformType,
          transportType: event.data.transportType,
          status: 'active',
          requestCount: 0,
          toolCallCount: 0,
        });
        break;
      }
      case 'session:disconnect': {
        const session = sessions.get(sessionId);
        if (session) {
          sessions.set(sessionId, { ...session, status: 'disconnected' });
        }
        break;
      }
      case 'session:idle': {
        const session = sessions.get(sessionId);
        if (session) {
          sessions.set(sessionId, { ...session, status: 'idle', lastActivityAt: event.timestamp });
        }
        break;
      }
      case 'session:active': {
        const session = sessions.get(sessionId);
        if (session) {
          sessions.set(sessionId, { ...session, status: 'active', lastActivityAt: event.timestamp });
        }
        break;
      }
    }

    setState({ sessions });
  };

  const handleRequestEvent = (event: RequestEvent) => {
    let requests = [...state.requests];

    switch (event.type) {
      case 'request:start': {
        const request: RequestInfo = {
          id: event.id,
          requestId: event.requestId ?? event.id,
          sessionId: event.sessionId,
          flowName: event.data.flowName,
          entryName: event.data.entryName,
          startTime: event.timestamp,
          status: 'pending',
          requestBody: event.data.requestBody,
        };
        requests.push(request);

        // Update session stats
        if (event.sessionId) {
          const sessions = new Map(state.sessions);
          const session = sessions.get(event.sessionId);
          if (session) {
            const isToolCall = event.data.flowName === 'tools:call-tool';
            sessions.set(event.sessionId, {
              ...session,
              lastActivityAt: event.timestamp,
              requestCount: session.requestCount + 1,
              toolCallCount: session.toolCallCount + (isToolCall ? 1 : 0),
            });
            setState({ sessions });
          }
        }
        break;
      }
      case 'request:complete':
      case 'request:error': {
        const idx = requests.findIndex((r) => r.requestId === event.requestId);
        if (idx !== -1) {
          requests[idx] = {
            ...requests[idx],
            endTime: event.timestamp,
            durationMs: event.data.durationMs,
            status: event.type === 'request:error' ? 'error' : 'complete',
            responseBody: event.data.responseBody,
            error: event.data.error,
          };
        }
        break;
      }
    }

    // Limit requests
    if (requests.length > MAX_REQUESTS) {
      requests = requests.slice(-MAX_REQUESTS);
    }

    setState({ requests });
  };

  const handleRegistryEvent = (event: RegistryEvent) => {
    const { registryType, snapshotCount, version } = event.data;
    const stats = { ...state.registryStats };

    switch (registryType) {
      case 'tool':
        stats.toolCount = snapshotCount;
        stats.toolVersion = version;
        break;
      case 'resource':
        stats.resourceCount = snapshotCount;
        stats.resourceVersion = version;
        break;
      case 'prompt':
        stats.promptCount = snapshotCount;
        stats.promptVersion = version;
        break;
      case 'agent':
        stats.agentCount = snapshotCount;
        stats.agentVersion = version;
        break;
    }

    setState({ registryStats: stats });
  };

  const handleServerEvent = (event: ServerEvent) => {
    switch (event.type) {
      case 'server:starting':
        setState({ serverStatus: 'starting', serverStartTime: event.timestamp });
        break;
      case 'server:ready':
        setState({
          serverStatus: 'running',
          serverInfo: event.data.serverInfo ?? null,
        });
        break;
      case 'server:error':
        setState({ serverStatus: 'error' });
        if (event.data.error) {
          handleLog('error', event.data.error, 'server');
        }
        break;
      case 'server:shutdown':
        setState({ serverStatus: 'stopped' });
        break;
    }
  };

  const handleScopeGraphEvent = (event: ScopeGraphEvent) => {
    setState({ scopeGraph: event.data.root });
  };

  const handleConfigEvent = (event: ConfigEvent) => {
    const configStatus = { ...state.configStatus };

    switch (event.type) {
      case 'config:loaded':
        configStatus.status = 'loaded';
        configStatus.loadedKeys = event.data.loadedKeys ?? [];
        break;
      case 'config:error':
        configStatus.status = 'error';
        configStatus.errors = event.data.errors ?? [];
        break;
      case 'config:missing':
        configStatus.status = 'missing';
        configStatus.missingKeys = event.data.missingKeys ?? [];
        break;
    }

    setState({ configStatus });
  };

  const handleEvent = (event: DevEvent) => {
    switch (event.category) {
      case 'session':
        handleSessionEvent(event as SessionEvent);
        break;
      case 'request':
        handleRequestEvent(event as RequestEvent);
        break;
      case 'registry':
        handleRegistryEvent(event as RegistryEvent);
        break;
      case 'server':
        if (event.type === 'scope:graph:update') {
          handleScopeGraphEvent(event as ScopeGraphEvent);
        } else {
          handleServerEvent(event as ServerEvent);
        }
        break;
      case 'config':
        handleConfigEvent(event as ConfigEvent);
        break;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  const store = {
    // State accessors
    get activeTab() {
      return state.activeTab;
    },
    get selectedSessionId() {
      return state.selectedSessionId;
    },
    get selectedRequestId() {
      return state.selectedRequestId;
    },
    get serverStatus() {
      return state.serverStatus;
    },
    get watchStatus() {
      return state.watchStatus;
    },
    get typeCheckStatus() {
      return state.typeCheckStatus;
    },
    get serverInfo() {
      return state.serverInfo;
    },
    get serverStartTime() {
      return state.serverStartTime;
    },
    get sessions() {
      return state.sessions;
    },
    get requests() {
      return state.requests;
    },
    get logs() {
      return state.logs;
    },
    get registryStats() {
      return state.registryStats;
    },
    get scopeGraph() {
      return state.scopeGraph;
    },
    get configStatus() {
      return state.configStatus;
    },
    get connectionStatus() {
      return state.connectionStatus;
    },
    get connectionMode() {
      return state.connectionMode;
    },

    // New state accessors (two-panel layout)
    get panelFocus() {
      return state.panelFocus;
    },
    get rightPanelTab() {
      return state.rightPanelTab;
    },
    get scrollStates() {
      return state.scrollStates;
    },
    get searchState() {
      return state.searchState;
    },
    get showHelp() {
      return state.showHelp;
    },
    get terminalWidth() {
      return state.terminalWidth;
    },
    get terminalHeight() {
      return state.terminalHeight;
    },

    // Actions (legacy)
    setActiveTab,
    selectSession,
    selectRequest,
    handleEvent,
    handleLog,
    setConnectionStatus,
    setConnectionMode,
    setWatchStatus,
    setTypeCheckStatus,
    clearLogs,
    clearRequests,
    reset,

    // New actions (two-panel layout)
    setFocus,
    setRightPanelTab,
    toggleFocus,
    scrollUp,
    scrollDown,
    pageUp,
    pageDown,
    scrollToTop,
    scrollToBottom,
    setViewportHeight,
    startSearch,
    updateSearchQuery,
    nextSearchResult,
    prevSearchResult,
    endSearch,
    toggleHelp,
    setTerminalSize,

    // Subscribe/getState for React integration
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
  };

  return store;
}

// Re-export types
export * from './types.js';
