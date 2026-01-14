//! FrontMCP Development Dashboard TUI
//!
//! A high-performance terminal UI for the FrontMCP development server.
//! Replaces the Ink-based dashboard with a native Rust implementation
//! using Ratatui for improved performance and responsiveness.

mod app;
mod event;
mod input;
mod state;
mod ui;

use std::io::stdout;

use anyhow::Result;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

use app::App;
use state::QuitMode;

#[tokio::main]
async fn main() -> Result<()> {
    // Setup terminal - crossterm handles keyboard input from /dev/tty automatically
    // when stdin is not a tty (e.g., when piped)
    enable_raw_mode()?;

    // Use stdout for rendering (works even when stdin is piped)
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture, Clear(ClearType::All))?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    // Create and run app
    let mut app = App::new();
    let result = app.run(&mut terminal).await;

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    // Handle any errors
    if let Err(err) = result {
        eprintln!("Error: {err:?}");
        std::process::exit(1);
    }

    // Exit with code 0 if we're killing the server (Ctrl+C or confirmed quit)
    // This signals to the CLI that cleanup should happen
    if app.quit_mode() == QuitMode::KillAll {
        std::process::exit(0);
    }

    Ok(())
}
