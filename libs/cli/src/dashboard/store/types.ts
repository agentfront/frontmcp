/**
 * Dashboard Store Types
 *
 * Defines the state shape for the dev dashboard.
 */

import type {
  DevEvent,
  SessionEvent,
  RequestEvent,
  RegistryEvent,
  ServerEvent,
  ScopeGraphNode,
} from '../events/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Panel Focus & Navigation
// ─────────────────────────────────────────────────────────────────────────────

export type PanelFocus = 'left' | 'right';
export type RightPanelTab = 'logs' | 'sessions' | 'tools' | 'api' | 'config';

export const RIGHT_PANEL_TABS: readonly RightPanelTab[] = ['logs', 'sessions', 'tools', 'api', 'config'] as const;

export const RIGHT_PANEL_TAB_LABELS: Record<RightPanelTab, string> = {
  logs: 'Logs',
  sessions: 'Sessions',
  tools: 'Tools',
  api: 'API',
  config: 'Config',
};

// ─────────────────────────────────────────────────────────────────────────────
// Search State
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchState {
  active: boolean;
  query: string;
  matchingIds: string[];
  currentIndex: number;
}

export const initialSearchState: SearchState = {
  active: false,
  query: '',
  matchingIds: [],
  currentIndex: -1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Scroll State
// ─────────────────────────────────────────────────────────────────────────────

export interface ScrollState {
  offset: number;
  selectedIndex: number;
  viewportHeight: number;
  /** If true, auto-scroll to bottom when new items arrive (for live logs) */
  autoScroll: boolean;
}

export const initialScrollState: ScrollState = {
  offset: 0,
  selectedIndex: 0,
  viewportHeight: 20,
  autoScroll: true, // Start with auto-scroll enabled
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab Names (legacy - kept for compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export type TabName = 'overview' | 'sessions' | 'tools' | 'api' | 'config';

export const TAB_LIST: readonly TabName[] = ['overview', 'sessions', 'tools', 'api', 'config'] as const;

export const TAB_LABELS: Record<TabName, string> = {
  overview: 'Overview',
  sessions: 'Sessions',
  tools: 'Tools',
  api: 'API',
  config: 'Config',
};

// ─────────────────────────────────────────────────────────────────────────────
// Session Info
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  clientInfo?: { name: string; version: string };
  platformType?: string;
  transportType?: string;
  status: 'active' | 'idle' | 'disconnected';
  requestCount: number;
  toolCallCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Info
// ─────────────────────────────────────────────────────────────────────────────

export interface RequestInfo {
  id: string;
  requestId: string;
  sessionId?: string;
  flowName: string;
  entryName?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'pending' | 'complete' | 'error';
  requestBody?: unknown;
  responseBody?: unknown;
  error?: { name: string; message: string; code?: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Entry
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'stdout' | 'stderr';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  source?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Status
// ─────────────────────────────────────────────────────────────────────────────

export type ServerStatus = 'starting' | 'running' | 'error' | 'stopped' | 'reloading';
export type WatchStatus = 'idle' | 'compiling' | 'ready' | 'error';
export type TypeCheckStatus = 'idle' | 'checking' | 'pass' | 'fail';

// ─────────────────────────────────────────────────────────────────────────────
// Registry Stats
// ─────────────────────────────────────────────────────────────────────────────

export interface RegistryStats {
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  agentCount: number;
  toolVersion: number;
  resourceVersion: number;
  promptVersion: number;
  agentVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Status
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigStatus {
  status: 'unknown' | 'loaded' | 'error' | 'missing';
  loadedKeys: string[];
  missingKeys: string[];
  errors: Array<{ path: string; message: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard State
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardState {
  // Navigation (legacy)
  activeTab: TabName;
  selectedSessionId: string | null;
  selectedRequestId: string | null;

  // New Navigation (two-panel layout)
  panelFocus: PanelFocus;
  rightPanelTab: RightPanelTab;
  scrollStates: Record<RightPanelTab, ScrollState>;

  // Search
  searchState: SearchState;

  // Help overlay
  showHelp: boolean;

  // Terminal dimensions
  terminalWidth: number;
  terminalHeight: number;

  // Server Status
  serverStatus: ServerStatus;
  watchStatus: WatchStatus;
  typeCheckStatus: TypeCheckStatus;
  serverInfo: { name: string; version: string } | null;
  serverStartTime: number | null;

  // Data Collections
  sessions: Map<string, SessionInfo>;
  requests: RequestInfo[];
  logs: LogEntry[];

  // Registry
  registryStats: RegistryStats;

  // Scope Graph
  scopeGraph: ScopeGraphNode | null;

  // Config
  configStatus: ConfigStatus;

  // Connection
  connectionStatus: 'disconnected' | 'connecting' | 'connected';
  connectionMode: 'ipc' | 'stderr' | 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export interface DashboardActions {
  // Navigation (legacy)
  setActiveTab: (tab: TabName) => void;
  selectSession: (id: string | null) => void;
  selectRequest: (id: string | null) => void;

  // New Navigation (two-panel layout)
  setFocus: (panel: PanelFocus) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  toggleFocus: () => void;

  // Scrolling
  scrollUp: () => void;
  scrollDown: () => void;
  pageUp: () => void;
  pageDown: () => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  setViewportHeight: (tab: RightPanelTab, height: number) => void;

  // Search
  startSearch: () => void;
  updateSearchQuery: (query: string) => void;
  nextSearchResult: () => void;
  prevSearchResult: () => void;
  endSearch: () => void;

  // Help
  toggleHelp: () => void;

  // Terminal size
  setTerminalSize: (width: number, height: number) => void;

  // Event handling
  handleEvent: (event: DevEvent) => void;
  handleLog: (level: LogLevel, message: string, source?: string) => void;

  // Connection
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected') => void;
  setConnectionMode: (mode: 'ipc' | 'stderr' | 'none') => void;

  // Server status
  setWatchStatus: (status: WatchStatus) => void;
  setTypeCheckStatus: (status: TypeCheckStatus) => void;

  // Clear
  clearLogs: () => void;
  clearRequests: () => void;
  reset: () => void;
}

export type DashboardStore = DashboardState & DashboardActions;

// ─────────────────────────────────────────────────────────────────────────────
// Initial State
// ─────────────────────────────────────────────────────────────────────────────

// Helper to create initial scroll states for all tabs
function createInitialScrollStates(): Record<RightPanelTab, ScrollState> {
  return {
    logs: { ...initialScrollState },
    sessions: { ...initialScrollState },
    tools: { ...initialScrollState },
    api: { ...initialScrollState },
    config: { ...initialScrollState },
  };
}

export const initialDashboardState: DashboardState = {
  // Navigation (legacy)
  activeTab: 'overview',
  selectedSessionId: null,
  selectedRequestId: null,

  // New Navigation (two-panel layout)
  panelFocus: 'right',
  rightPanelTab: 'logs',
  scrollStates: createInitialScrollStates(),

  // Search
  searchState: { ...initialSearchState },

  // Help overlay
  showHelp: false,

  // Terminal dimensions (default, will be updated on mount)
  terminalWidth: 120,
  terminalHeight: 40,

  // Server Status
  serverStatus: 'starting',
  watchStatus: 'idle',
  typeCheckStatus: 'idle',
  serverInfo: null,
  serverStartTime: null,

  // Data Collections
  sessions: new Map(),
  requests: [],
  logs: [],

  // Registry
  registryStats: {
    toolCount: 0,
    resourceCount: 0,
    promptCount: 0,
    agentCount: 0,
    toolVersion: 0,
    resourceVersion: 0,
    promptVersion: 0,
    agentVersion: 0,
  },

  // Scope Graph
  scopeGraph: null,

  // Config
  configStatus: {
    status: 'unknown',
    loadedKeys: [],
    missingKeys: [],
    errors: [],
  },

  // Connection
  connectionStatus: 'disconnected',
  connectionMode: 'none',
};
