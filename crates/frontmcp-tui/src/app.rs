//! Application state and main event loop

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::prelude::*;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio::sync::mpsc;

use crate::event::{
    parse_unified_event_line, spawn_socket_client, ResponseMessage, SocketClientHandle,
    StateSnapshot, UnifiedEvent,
};
use crate::input::InputHandler;
use crate::state::{ActivitySubTab, DashboardState, FocusArea, QuitDialogSelection, QuitMode, Tab};
use crate::ui;

/// Main application struct
pub struct App {
    /// Dashboard state
    pub state: DashboardState,
    /// Whether the app should quit
    pub should_quit: bool,
    /// Input handler
    input_handler: InputHandler,
    /// Socket client handle for sending commands (if connected via socket)
    pub socket_handle: Option<SocketClientHandle>,
}

impl App {
    /// Create a new App instance
    pub fn new() -> Self {
        Self {
            state: DashboardState::default(),
            should_quit: false,
            input_handler: InputHandler::new(),
            socket_handle: None,
        }
    }

    /// Run the main application loop
    pub async fn run(&mut self, terminal: &mut Terminal<impl Backend>) -> Result<()> {
        // Create channel for dev events (unified format supports both legacy and new events)
        let (tx, mut rx) = mpsc::channel::<UnifiedEvent>(100);

        // Create channel for raw log lines (non-event stderr output)
        let (log_tx, mut log_rx) = mpsc::channel::<String>(100);

        // Create channel for system metrics (cpu%, memory bytes)
        let (metrics_tx, mut metrics_rx) = mpsc::channel::<(f32, u64)>(10);

        // Track pipe connection status and counters
        let pipe_connected = Arc::new(AtomicBool::new(false));
        let lines_read = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let parse_failures = Arc::new(std::sync::atomic::AtomicU64::new(0));

        // Spawn system metrics collector (samples every second)
        tokio::task::spawn_blocking(move || {
            let mut sys = System::new();
            let pid = Pid::from_u32(std::process::id());

            loop {
                // Refresh process-specific CPU and memory
                sys.refresh_processes_specifics(
                    ProcessesToUpdate::Some(&[pid]),
                    false, // don't remove dead processes
                    ProcessRefreshKind::everything(),
                );

                if let Some(proc) = sys.process(pid) {
                    let cpu = proc.cpu_usage();
                    let memory = proc.memory(); // bytes
                    if metrics_tx.blocking_send((cpu, memory)).is_err() {
                        break; // Channel closed, exit
                    }
                }

                std::thread::sleep(Duration::from_secs(1));
            }
        });

        // Create channel for initial state snapshot (used by socket client)
        let (state_tx, mut state_rx) = mpsc::channel::<StateSnapshot>(1);

        // Create channel for command responses
        let mut response_rx: Option<mpsc::Receiver<ResponseMessage>> = None;

        // Record when we started trying to connect
        self.state.connection_started_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        );

        // Check for socket path from environment (new ManagerService connection)
        if let Ok(socket_path) = std::env::var("FRONTMCP_SOCKET_PATH") {
            self.state.socket_path = Some(socket_path.clone());

            // Spawn socket client - returns handle for sending commands
            let tx_clone = tx.clone();
            match spawn_socket_client(socket_path, tx_clone, state_tx.clone()) {
                Ok((handle, rx)) => {
                    self.socket_handle = Some(handle);
                    response_rx = Some(rx);
                    self.state.socket_connected = true;
                    // Mark as connected via socket
                    pipe_connected.store(true, Ordering::SeqCst);
                }
                Err(err) => {
                    // Store the error so it can be displayed in the UI
                    let error_msg = err.message.clone();
                    // Add error to logs so it shows in the Logs tab
                    self.state.add_log(
                        crate::state::LogLevel::Error,
                        format!("Connection failed: {}", err),
                        "tui",
                    );
                    self.state.connection_error = Some(error_msg);
                }
            }
        }

        // Check for event pipe path from environment (legacy pipe-based system)
        if let Ok(pipe_path) = std::env::var("FRONTMCP_EVENT_PIPE") {
            self.state.pipe_path = Some(pipe_path.clone());

            // Clone for the spawned task
            let pipe_connected_clone = Arc::clone(&pipe_connected);
            let lines_read_clone = Arc::clone(&lines_read);
            let parse_failures_clone = Arc::clone(&parse_failures);

            // Spawn task to tail the event pipe file
            tokio::task::spawn_blocking(move || {
                // Wait for file to exist
                while !std::path::Path::new(&pipe_path).exists() {
                    std::thread::sleep(Duration::from_millis(50));
                }

                let file = match File::open(&pipe_path) {
                    Ok(f) => f,
                    Err(_) => return,
                };

                // Signal that we're connected
                pipe_connected_clone.store(true, Ordering::SeqCst);

                // Start from beginning to catch events that arrived before TUI started
                let mut reader = BufReader::new(file);
                let mut line = String::new();

                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            // No data available, sleep briefly
                            std::thread::sleep(Duration::from_millis(10));
                        }
                        Ok(_) => {
                            // Remove only trailing newline, preserve leading whitespace for JSON indentation
                            let line_content = line.trim_end();
                            if !line_content.trim().is_empty() {
                                lines_read_clone.fetch_add(1, Ordering::SeqCst);

                                // Only count as potential event if it has the magic prefix
                                let is_potential_event = line_content.contains("__FRONTMCP_DEV_EVENT__");

                                if let Some(event) = parse_unified_event_line(line_content) {
                                    if tx.blocking_send(event).is_err() {
                                        break;
                                    }
                                } else if is_potential_event {
                                    // Only count as parse failure if it looked like an event
                                    parse_failures_clone.fetch_add(1, Ordering::SeqCst);
                                } else {
                                    // Send non-event lines to the log channel (preserve indentation)
                                    let _ = log_tx.blocking_send(line_content.to_string());
                                }
                            }
                        }
                        Err(_) => {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                    }
                }
            });
        }

        loop {
            // Update pipe connection status and counters
            self.state.pipe_connected = pipe_connected.load(Ordering::SeqCst);
            self.state.lines_read = lines_read.load(Ordering::SeqCst);
            self.state.parse_failures = parse_failures.load(Ordering::SeqCst);
            // Draw UI
            terminal.draw(|frame| self.render(frame))?;

            // Handle initial state snapshot from ManagerService (non-blocking)
            // This is received once when first connecting via Unix socket
            if let Ok(snapshot) = state_rx.try_recv() {
                self.state.handle_state_snapshot(snapshot);
            }

            // Handle dev events (non-blocking) - unified format supports both legacy and new events
            while let Ok(unified_event) = rx.try_recv() {
                self.state.handle_unified_event(unified_event);
            }

            // Handle raw log lines (non-blocking)
            while let Ok(log_line) = log_rx.try_recv() {
                self.state.add_raw_log(log_line);
            }

            // Handle system metrics updates (non-blocking)
            while let Ok((cpu, memory)) = metrics_rx.try_recv() {
                self.state.metrics.update_system_metrics(cpu, memory);
            }

            // Handle command responses from socket (non-blocking)
            if let Some(ref mut rx) = response_rx {
                while let Ok(response) = rx.try_recv() {
                    self.state.handle_command_response(response);
                }
            }

            // Handle terminal events (keyboard input)
            if event::poll(Duration::from_millis(16))? {
                match event::read()? {
                    Event::Key(key) => {
                        // Handle quit confirmation dialog first
                        if self.state.quit_mode == QuitMode::Confirming {
                            match key.code {
                                // Arrow keys to switch selection
                                KeyCode::Left | KeyCode::Right => {
                                    self.state.quit_dialog_selection = match self.state.quit_dialog_selection {
                                        QuitDialogSelection::Cancel => QuitDialogSelection::Kill,
                                        QuitDialogSelection::Kill => QuitDialogSelection::Cancel,
                                    };
                                }
                                // Enter confirms current selection
                                KeyCode::Enter => {
                                    match self.state.quit_dialog_selection {
                                        QuitDialogSelection::Cancel => {
                                            self.state.quit_mode = QuitMode::None;
                                            self.state.quit_dialog_selection = QuitDialogSelection::Cancel;
                                        }
                                        QuitDialogSelection::Kill => {
                                            self.state.quit_mode = QuitMode::KillAll;
                                            self.should_quit = true;
                                        }
                                    }
                                }
                                // Esc cancels
                                KeyCode::Esc => {
                                    self.state.quit_mode = QuitMode::None;
                                    self.state.quit_dialog_selection = QuitDialogSelection::Cancel;
                                }
                                // Ctrl+C still works to immediately quit
                                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                                    self.state.quit_mode = QuitMode::KillAll;
                                    self.should_quit = true;
                                }
                                _ => {}
                            }
                        }
                        // Ctrl+C: immediate quit (single press), kills server
                        else if key.code == KeyCode::Char('c')
                            && key.modifiers.contains(KeyModifiers::CONTROL)
                        {
                            self.state.quit_mode = QuitMode::KillAll;
                            self.should_quit = true;
                        }
                        // 'q' shows confirmation dialog when on tab bar
                        else if key.code == KeyCode::Char('q')
                            && self.state.focus == crate::state::FocusArea::TabBar
                        {
                            self.state.quit_mode = QuitMode::Confirming;
                            self.state.quit_dialog_selection = QuitDialogSelection::Cancel; // Default to Cancel
                        } else {
                            self.input_handler.handle_key(&mut self.state, key);
                        }
                    }
                    Event::Resize(_width, _height) => {
                        // Terminal automatically gets new size on next draw
                    }
                    Event::Mouse(mouse) => {
                        let size = terminal.size().unwrap_or_default();
                        let term_rect = Rect::new(0, 0, size.width, size.height);
                        self.handle_mouse_event(mouse, term_rect);
                    }
                    _ => {}
                }
            }

            if self.should_quit {
                break;
            }
        }

        Ok(())
    }

    /// Handle mouse events for tab clicking and panel scrolling
    fn handle_mouse_event(&mut self, mouse: MouseEvent, term_size: Rect) {
        // Calculate layout areas
        // Main layout: status bar (1), content (fill), key hints (2)
        let status_bar_height = 1u16;
        let key_hints_height = 2u16;
        let content_height = term_size.height.saturating_sub(status_bar_height + key_hints_height);

        // Content area starts after status bar
        let content_y_start = status_bar_height;
        let content_y_end = content_y_start + content_height;

        // Content is split: overview (25%) and tab area (75%)
        let overview_width = term_size.width * 25 / 100;
        let tab_area_x_start = overview_width;

        // Tab area is split: tab bar (3 lines) and content
        let tab_bar_height = 3u16;
        let tab_bar_y_start = content_y_start;
        let tab_bar_y_end = tab_bar_y_start + tab_bar_height;
        let tab_content_y_start = tab_bar_y_end;

        match mouse.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                // Check if click is in tab bar area
                if mouse.row >= tab_bar_y_start
                    && mouse.row < tab_bar_y_end
                    && mouse.column >= tab_area_x_start
                {
                    // Calculate which tab was clicked
                    if let Some(tab) = self.get_tab_at_position(mouse.column - tab_area_x_start) {
                        self.state.active_tab = tab;
                        self.state.focus = FocusArea::TabBar;
                        // Reset list selection when switching tabs
                        self.state.list_selected = 0;
                        self.state.list_scroll = 0;
                        self.state.detail_scroll = 0;
                    }
                }
                // Check if click is in overview panel (left side)
                else if mouse.column < overview_width && mouse.row >= content_y_start && mouse.row < content_y_end {
                    self.state.focus = FocusArea::Overview;
                }
                // Check if click is in tab content area
                else if mouse.column >= tab_area_x_start && mouse.row >= tab_content_y_start && mouse.row < content_y_end {
                    // For tabs with list/detail layout, determine if click is on list or detail
                    let tab_content_width = term_size.width - tab_area_x_start;
                    let list_width = tab_content_width * 40 / 100; // 40% for list
                    let relative_x = mouse.column - tab_area_x_start;

                    // Special handling for Capabilities tab sub-tabs
                    if self.state.active_tab == Tab::Capabilities {
                        // Sub-tab bar is the first 3 rows of tab content
                        let sub_tab_bar_height = 3u16;
                        let sub_tab_bar_y_end = tab_content_y_start + sub_tab_bar_height;

                        if mouse.row >= tab_content_y_start && mouse.row < sub_tab_bar_y_end {
                            // Click is in sub-tab bar area
                            if let Some(sub_tab) = self.get_sub_tab_at_position(relative_x) {
                                self.state.activity_sub_tab = sub_tab;
                                self.state.focus = FocusArea::SubTab;
                                // Reset list selection when switching sub-tabs
                                self.state.list_selected = 0;
                                self.state.list_scroll = 0;
                                self.state.detail_scroll = 0;
                            }
                            return;
                        }
                    }

                    match self.state.active_tab {
                        Tab::Sessions | Tab::Capabilities => {
                            if relative_x < list_width {
                                self.state.focus = FocusArea::List;
                            } else {
                                self.state.focus = FocusArea::Detail;
                            }
                        }
                        Tab::Logs => {
                            self.state.focus = FocusArea::List;
                        }
                        _ => {}
                    }
                }
            }
            MouseEventKind::ScrollUp => {
                // Scroll based on mouse position
                if mouse.column < overview_width && mouse.row >= content_y_start && mouse.row < content_y_end {
                    // Scroll overview panel
                    self.state.overview_scroll = self.state.overview_scroll.saturating_sub(3);
                } else if mouse.column >= tab_area_x_start && mouse.row >= tab_content_y_start && mouse.row < content_y_end {
                    // Scroll in tab content area
                    let tab_content_width = term_size.width - tab_area_x_start;
                    let list_width = tab_content_width * 40 / 100;
                    let relative_x = mouse.column - tab_area_x_start;

                    match self.state.active_tab {
                        Tab::Logs => {
                            self.state.scroll_logs_up(3);
                        }
                        Tab::Sessions | Tab::Capabilities => {
                            if relative_x < list_width {
                                // Scroll list
                                self.state.list_scroll = self.state.list_scroll.saturating_sub(3);
                                if self.state.list_selected > 0 {
                                    self.state.list_selected = self.state.list_selected.saturating_sub(3);
                                }
                            } else {
                                // Scroll detail panel
                                self.state.detail_scroll = self.state.detail_scroll.saturating_sub(3);
                            }
                        }
                        Tab::Metrics | Tab::Graph => {
                            // Scroll detail area
                            self.state.detail_scroll = self.state.detail_scroll.saturating_sub(3);
                        }
                        _ => {}
                    }
                }
            }
            MouseEventKind::ScrollDown => {
                // Scroll based on mouse position
                if mouse.column < overview_width && mouse.row >= content_y_start && mouse.row < content_y_end {
                    // Scroll overview panel (generous limit for any content size)
                    self.state.overview_scroll = self.state.overview_scroll.saturating_add(3).min(500);
                } else if mouse.column >= tab_area_x_start && mouse.row >= tab_content_y_start && mouse.row < content_y_end {
                    // Scroll in tab content area
                    let tab_content_width = term_size.width - tab_area_x_start;
                    let list_width = tab_content_width * 40 / 100;
                    let relative_x = mouse.column - tab_area_x_start;

                    match self.state.active_tab {
                        Tab::Logs => {
                            self.state.scroll_logs_down(3);
                        }
                        Tab::Sessions => {
                            if relative_x < list_width {
                                // Scroll list
                                let max = self.state.sessions.len().saturating_sub(1);
                                self.state.list_scroll = self.state.list_scroll.saturating_add(3).min(max);
                                self.state.list_selected = self.state.list_selected.saturating_add(3).min(max);
                            } else {
                                // Scroll detail panel
                                self.state.detail_scroll = self.state.detail_scroll.saturating_add(3).min(500);
                            }
                        }
                        Tab::Capabilities => {
                            if relative_x < list_width {
                                // Scroll list based on active sub-tab
                                let max = match self.state.activity_sub_tab {
                                    crate::state::ActivitySubTab::Tools => self.state.tools.len(),
                                    crate::state::ActivitySubTab::Resources => self.state.resources.len(),
                                    crate::state::ActivitySubTab::Prompts => self.state.prompts.len(),
                                    crate::state::ActivitySubTab::Plugins => self.state.apps.len(),
                                }.saturating_sub(1);
                                self.state.list_scroll = self.state.list_scroll.saturating_add(3).min(max);
                                self.state.list_selected = self.state.list_selected.saturating_add(3).min(max);
                            } else {
                                // Scroll detail panel
                                self.state.detail_scroll = self.state.detail_scroll.saturating_add(3).min(500);
                            }
                        }
                        Tab::Metrics | Tab::Graph => {
                            // Scroll detail area
                            self.state.detail_scroll = self.state.detail_scroll.saturating_add(3).min(500);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    /// Calculate which tab is at a given X position relative to tab bar start
    fn get_tab_at_position(&self, x: u16) -> Option<Tab> {
        let tabs = Tab::all();
        let divider = " │ "; // 3 chars
        let divider_len = divider.len() as u16;

        let mut current_x = 0u16;
        for (i, tab) in tabs.iter().enumerate() {
            let tab_name_len = tab.name().len() as u16;
            let tab_end = current_x + tab_name_len;

            // Check if x is within this tab's bounds
            if x >= current_x && x < tab_end {
                return Some(*tab);
            }

            // Move past this tab and its divider (except for last tab)
            current_x = tab_end;
            if i < tabs.len() - 1 {
                current_x += divider_len;
            }
        }

        None
    }

    /// Calculate which sub-tab is at a given X position relative to sub-tab bar start
    /// Used for Capabilities tab sub-tabs (Tools, Resources, Prompts, Plugins)
    fn get_sub_tab_at_position(&self, x: u16) -> Option<ActivitySubTab> {
        let sub_tabs = ActivitySubTab::all();
        let divider = " │ "; // 3 chars
        let divider_len = divider.len() as u16;

        let mut current_x = 0u16;
        for (i, sub_tab) in sub_tabs.iter().enumerate() {
            // Format: "Tools (5)" - need to account for count suffix
            let count = match sub_tab {
                ActivitySubTab::Tools => self.state.tools.len(),
                ActivitySubTab::Resources => self.state.resources.len(),
                ActivitySubTab::Prompts => self.state.prompts.len(),
                ActivitySubTab::Plugins => self.state.plugins.len(),
            };
            let tab_text = format!("{} ({})", sub_tab.name(), count);
            let tab_len = tab_text.len() as u16;
            let tab_end = current_x + tab_len;

            if x >= current_x && x < tab_end {
                return Some(*sub_tab);
            }

            current_x = tab_end;
            if i < sub_tabs.len() - 1 {
                current_x += divider_len;
            }
        }
        None
    }

    /// Minimum terminal size for the TUI
    const MIN_WIDTH: u16 = 80;
    const MIN_HEIGHT: u16 = 20;

    /// Render the UI (public for NAPI access)
    pub fn render(&self, frame: &mut Frame) {
        let area = frame.area();

        // Check for minimum screen size
        if area.width < Self::MIN_WIDTH || area.height < Self::MIN_HEIGHT {
            self.render_small_screen_message(frame, area);
            return;
        }

        // Main layout: status bar, content, key hints
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(1),  // Status bar
                Constraint::Fill(1),    // Main content - fills all remaining space
                Constraint::Length(2),  // Key hints
            ])
            .split(area);

        // Render components
        ui::status_bar::render(frame, chunks[0], &self.state);
        ui::layout::render(frame, chunks[1], &self.state);
        ui::key_hints::render(frame, chunks[2], &self.state);

        // Render help overlay if active
        if self.state.show_help {
            ui::help_overlay::render(frame, area);
        }

        // Render quit confirmation dialog if active
        if self.state.quit_mode == QuitMode::Confirming {
            ui::quit_dialog::render(frame, area, self.state.quit_dialog_selection);
        }
    }

    /// Get the quit mode for exit code determination
    pub fn quit_mode(&self) -> QuitMode {
        self.state.quit_mode
    }

    /// Render a message when the screen is too small
    fn render_small_screen_message(&self, frame: &mut Frame, area: Rect) {
        use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

        let message = format!(
            "Terminal too small!\n\n\
             Current: {}x{}\n\
             Minimum: {}x{}\n\n\
             Please:\n\
             - Resize your terminal window\n\
             - Reduce font size (Cmd/Ctrl+-)\n\
             - Or run with --no-dashboard\n\n\
             Press Ctrl+C to exit",
            area.width, area.height,
            Self::MIN_WIDTH, Self::MIN_HEIGHT
        );

        let paragraph = Paragraph::new(message)
            .block(
                Block::default()
                    .title(" FrontMCP ")
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(Color::Yellow)),
            )
            .style(Style::default().fg(Color::Yellow))
            .wrap(Wrap { trim: false })
            .alignment(Alignment::Center);

        frame.render_widget(paragraph, area);
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
