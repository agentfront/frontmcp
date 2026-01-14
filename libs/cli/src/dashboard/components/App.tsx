/**
 * Dashboard App - Root component (NX-style two-panel layout)
 *
 * Main entry point for the Ink-based dashboard UI.
 * Features vim-style navigation, search, and responsive layout.
 */

import React, { useEffect, useSyncExternalStore } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { ChildProcess } from 'child_process';
import { DevEventClient } from '../events/dev-event-client.js';
import { createDashboardStore, RIGHT_PANEL_TABS, RIGHT_PANEL_TAB_LABELS } from '../store/index.js';
import type { RightPanelTab } from '../store/types.js';
import { StatusBar } from './layout/StatusBar.js';
import { TwoPanelLayout } from './layout/TwoPanelLayout.js';
import { KeyHints } from './layout/KeyHints.js';
import { LeftMasterPanel } from './panels/LeftMasterPanel.js';
import { LogStreamPanel } from './panels/LogStreamPanel.js';
import { SessionsPanel } from './panels/SessionsPanel.js';
import { ToolsPanel } from './panels/ToolsPanel.js';
import { ApiPanel } from './panels/ApiPanel.js';
import { ConfigPanel } from './panels/ConfigPanel.js';
import { HelpOverlay } from './overlays/HelpOverlay.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

export interface AppProps {
  /** Child process running the MCP server */
  serverProcess: ChildProcess;
  /** Child process running tsc --watch (optional) */
  checkerProcess?: ChildProcess;
  /** Entry file path */
  entryPath: string;
}

// Create store once
const store = createDashboardStore();

export function App({ serverProcess, checkerProcess, entryPath }: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Subscribe to store changes
  const state = useSyncExternalStore(store.subscribe, store.getState);

  // Track terminal size
  const { isCompact, height: terminalHeight } = useTerminalSize(store);

  // Calculate and update viewport height based on terminal size
  // Reserve space for: status bar (1), tabs bar (1), key hints (2), borders (~4)
  useEffect(() => {
    const reservedLines = 8; // Status bar + tabs + key hints + borders
    const viewportHeight = Math.max(5, terminalHeight - reservedLines);

    // Update viewport height for all tabs
    store.setViewportHeight('logs', viewportHeight);
    store.setViewportHeight('sessions', viewportHeight);
    store.setViewportHeight('tools', viewportHeight);
    store.setViewportHeight('api', viewportHeight);
    store.setViewportHeight('config', viewportHeight);
  }, [terminalHeight]);

  // Set up event client
  useEffect(() => {
    const client = new DevEventClient();

    // Handle events from child process
    client.subscribe((event) => {
      store.handleEvent(event);
    });

    // Handle log messages
    client.on('log', ({ level, message }: { level: string; message: string }) => {
      store.handleLog(level as 'stdout' | 'stderr', message);
    });

    // Handle connection status
    client.on('connected', (mode: string) => {
      store.setConnectionStatus('connected');
      store.setConnectionMode(mode as 'ipc' | 'stderr' | 'none');
    });

    client.on('disconnected', () => {
      store.setConnectionStatus('disconnected');
    });

    // Attach to server process
    store.setConnectionStatus('connecting');
    client.attach(serverProcess);

    // Handle stdout from server (as log messages)
    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          store.handleLog('stdout', line);
        }
      });
    }

    // Handle type checker output
    if (checkerProcess) {
      if (checkerProcess.stdout) {
        checkerProcess.stdout.on('data', (data: Buffer) => {
          const text = data.toString();
          // Parse tsc output for status
          if (text.includes('Starting compilation')) {
            store.setTypeCheckStatus('checking');
          } else if (text.includes('Found 0 errors')) {
            store.setTypeCheckStatus('pass');
          } else if (text.includes('error TS')) {
            store.setTypeCheckStatus('fail');
          }
          // Also log it
          for (const line of text.split('\n').filter(Boolean)) {
            store.handleLog('info', line, 'tsc');
          }
        });
      }
      if (checkerProcess.stderr) {
        checkerProcess.stderr.on('data', (data: Buffer) => {
          for (const line of data.toString().split('\n').filter(Boolean)) {
            store.handleLog('error', line, 'tsc');
          }
        });
      }
    }

    return () => {
      client.destroy();
    };
  }, [serverProcess, checkerProcess]);

  // Keyboard navigation - all in one place for clarity
  useInput((input, key) => {
    // Don't process navigation when help is showing (HelpOverlay handles its own input)
    if (state.showHelp) {
      return;
    }

    // Search mode input handling
    if (state.searchState.active) {
      if (key.escape) {
        store.endSearch();
        return;
      }
      if (key.return) {
        store.endSearch();
        return;
      }
      if (input === 'n' && !key.ctrl) {
        store.nextSearchResult();
        return;
      }
      if (input === 'N') {
        store.prevSearchResult();
        return;
      }
      if (key.backspace || key.delete) {
        store.updateSearchQuery(state.searchState.query.slice(0, -1));
        return;
      }
      if (input && input.length === 1 && !key.ctrl && !key.meta) {
        store.updateSearchQuery(state.searchState.query + input);
        return;
      }
      return;
    }

    // Start search
    if (input === '/') {
      store.startSearch();
      return;
    }

    // Toggle help
    if (input === '?') {
      store.toggleHelp();
      return;
    }

    // Quit
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    // Clear logs
    if (key.ctrl && input === 'l') {
      store.clearLogs();
      return;
    }

    // Panel focus navigation
    if (input === 'h' || key.leftArrow) {
      store.setFocus('left');
      return;
    }
    if (input === 'l' || key.rightArrow) {
      store.setFocus('right');
      return;
    }
    if (key.tab) {
      store.toggleFocus();
      return;
    }

    // Tab switching with number keys
    if (input >= '1' && input <= '5') {
      const index = parseInt(input) - 1;
      if (index < RIGHT_PANEL_TABS.length) {
        store.setRightPanelTab(RIGHT_PANEL_TABS[index]);
        store.setFocus('right');
      }
      return;
    }

    // Vim navigation (only when right panel has focus)
    if (state.panelFocus === 'right') {
      if (input === 'j' || key.downArrow) {
        store.scrollDown();
        return;
      }
      if (input === 'k' || key.upArrow) {
        store.scrollUp();
        return;
      }
      if (input === 'g') {
        store.scrollToTop();
        return;
      }
      if (input === 'G') {
        store.scrollToBottom();
        return;
      }
      if (key.ctrl && input === 'd') {
        store.pageDown();
        return;
      }
      if (key.ctrl && input === 'u') {
        store.pageUp();
        return;
      }
    }
  });

  // Render right panel content based on active tab
  const renderRightPanelContent = () => {
    switch (state.rightPanelTab) {
      case 'logs':
        return <LogStreamPanel state={state} scrollState={state.scrollStates.logs} searchState={state.searchState} />;
      case 'sessions':
        return <SessionsPanel state={state} store={store} />;
      case 'tools':
        return <ToolsPanel state={state} store={store} />;
      case 'api':
        return <ApiPanel state={state} store={store} />;
      case 'config':
        return <ConfigPanel state={state} store={store} />;
      default:
        return null;
    }
  };

  // Right panel tabs bar
  const RightPanelTabs = () => (
    <Box gap={1} marginBottom={1}>
      {RIGHT_PANEL_TABS.map((tab, index) => {
        const isActive = state.rightPanelTab === tab;
        return (
          <Text key={tab} bold={isActive} color={isActive ? 'cyan' : 'gray'}>
            {index + 1}:{RIGHT_PANEL_TAB_LABELS[tab]}
          </Text>
        );
      })}
    </Box>
  );

  return (
    <Box flexDirection="column" height="100%">
      {/* Top status bar */}
      <StatusBar
        serverStatus={state.serverStatus}
        watchStatus={state.watchStatus}
        typeCheckStatus={state.typeCheckStatus}
        connectionStatus={state.connectionStatus}
        entryPath={entryPath}
      />

      {/* Main two-panel layout */}
      <TwoPanelLayout
        leftPanel={<LeftMasterPanel state={state} compact={isCompact} />}
        rightPanel={
          <Box flexDirection="column" flexGrow={1}>
            <RightPanelTabs />
            {renderRightPanelContent()}
          </Box>
        }
        leftWidth={isCompact ? '25%' : '30%'}
        focus={state.panelFocus}
      />

      {/* Bottom key hints */}
      <KeyHints searchActive={state.searchState.active} compact={isCompact} />

      {/* Help overlay */}
      {state.showHelp && <HelpOverlay onClose={() => store.toggleHelp()} />}
    </Box>
  );
}
