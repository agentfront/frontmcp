//! Application state and main event loop

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyModifiers, MouseEventKind};
use ratatui::prelude::*;
use tokio::sync::mpsc;

use crate::event::{parse_event_line, DevEvent};
use crate::input::InputHandler;
use crate::state::{DashboardState, QuitMode};
use crate::ui;

/// Main application struct
pub struct App {
    /// Dashboard state
    pub state: DashboardState,
    /// Whether the app should quit
    pub should_quit: bool,
    /// Input handler
    input_handler: InputHandler,
}

impl App {
    /// Create a new App instance
    pub fn new() -> Self {
        Self {
            state: DashboardState::default(),
            should_quit: false,
            input_handler: InputHandler::new(),
        }
    }

    /// Run the main application loop
    pub async fn run(&mut self, terminal: &mut Terminal<impl Backend>) -> Result<()> {
        // Create channel for dev events
        let (tx, mut rx) = mpsc::channel::<DevEvent>(100);

        // Create channel for raw log lines (non-event stderr output)
        let (log_tx, mut log_rx) = mpsc::channel::<String>(100);

        // Track pipe connection status and counters
        let pipe_connected = Arc::new(AtomicBool::new(false));
        let lines_read = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let parse_failures = Arc::new(std::sync::atomic::AtomicU64::new(0));

        // Check for event pipe path from environment
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
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                lines_read_clone.fetch_add(1, Ordering::SeqCst);

                                // Only count as potential event if it has the magic prefix
                                let is_potential_event = trimmed.contains("__FRONTMCP_DEV_EVENT__");

                                if let Some(event) = parse_event_line(trimmed) {
                                    if tx.blocking_send(event).is_err() {
                                        break;
                                    }
                                } else if is_potential_event {
                                    // Only count as parse failure if it looked like an event
                                    parse_failures_clone.fetch_add(1, Ordering::SeqCst);
                                } else {
                                    // Send non-event lines to the log channel
                                    let _ = log_tx.blocking_send(trimmed.to_string());
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

            // Handle dev events (non-blocking)
            while let Ok(dev_event) = rx.try_recv() {
                self.state.handle_event(dev_event);
            }

            // Handle raw log lines (non-blocking)
            while let Ok(log_line) = log_rx.try_recv() {
                self.state.add_raw_log(log_line);
            }

            // Handle terminal events (keyboard input)
            if event::poll(Duration::from_millis(16))? {
                match event::read()? {
                    Event::Key(key) => {
                        // Handle quit confirmation dialog first
                        if self.state.quit_mode == QuitMode::Confirming {
                            match key.code {
                                KeyCode::Char('y') | KeyCode::Char('Y') => {
                                    self.state.quit_mode = QuitMode::KillAll;
                                    self.should_quit = true;
                                }
                                KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                                    self.state.quit_mode = QuitMode::None;
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
                        } else {
                            self.input_handler.handle_key(&mut self.state, key);
                        }
                    }
                    Event::Resize(_width, _height) => {
                        // Terminal automatically gets new size on next draw
                    }
                    Event::Mouse(mouse) => {
                        match mouse.kind {
                            MouseEventKind::ScrollUp => {
                                match self.state.active_tab {
                                    crate::state::Tab::Logs => {
                                        self.state.scroll_logs_up(3);
                                    }
                                    crate::state::Tab::Sessions => {
                                        // Scroll up in sessions list
                                        self.state.list_scroll = self.state.list_scroll.saturating_sub(3);
                                        if self.state.list_selected > 0 {
                                            self.state.list_selected = self.state.list_selected.saturating_sub(3);
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            MouseEventKind::ScrollDown => {
                                match self.state.active_tab {
                                    crate::state::Tab::Logs => {
                                        self.state.scroll_logs_down(3);
                                    }
                                    crate::state::Tab::Sessions => {
                                        // Scroll down in sessions list
                                        let max = self.state.sessions.len().saturating_sub(1);
                                        self.state.list_scroll = self.state.list_scroll.saturating_add(3).min(max);
                                        self.state.list_selected = self.state.list_selected.saturating_add(3).min(max);
                                    }
                                    _ => {}
                                }
                            }
                            _ => {}
                        }
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

    /// Render the UI (public for NAPI access)
    pub fn render(&self, frame: &mut Frame) {
        let area = frame.area();

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
            ui::quit_dialog::render(frame, area);
        }
    }

    /// Get the quit mode for exit code determination
    pub fn quit_mode(&self) -> QuitMode {
        self.state.quit_mode
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
