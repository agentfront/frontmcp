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

use std::io::{stdout, Write};
use std::panic;

use anyhow::Result;
use crossterm::{
    event::{DisableMouseCapture, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

use app::App;
use state::QuitMode;

/// Restore the terminal to normal state (used for cleanup on panic/exit)
fn restore_terminal() {
    let _ = disable_raw_mode();
    let mut stdout = stdout();
    let _ = execute!(stdout, LeaveAlternateScreen, DisableMouseCapture, Clear(ClearType::All));
    let _ = stdout.flush();
}

#[tokio::main]
async fn main() -> Result<()> {
    // Install panic hook to restore terminal before printing panic message
    let original_hook = panic::take_hook();
    panic::set_hook(Box::new(move |panic_info| {
        restore_terminal();
        // Print panic info cleanly
        eprintln!("\n\x1b[31m=== TUI CRASH ===\x1b[0m\n");
        original_hook(panic_info);
        eprintln!("\n\x1b[31m=================\x1b[0m\n");
    }));

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
    restore_terminal();
    let mut out = std::io::stdout();
    execute!(out, crossterm::cursor::Show)?;

    // Handle any errors
    if let Err(err) = result {
        eprintln!("\n\x1b[31m=== TUI ERROR ===\x1b[0m\n");
        eprintln!("{err:?}");
        eprintln!("\n\x1b[31m=================\x1b[0m\n");
        std::process::exit(1);
    }

    // Exit with code 0 if we're killing the server (Ctrl+C or confirmed quit)
    // This signals to the CLI that cleanup should happen
    if app.quit_mode() == QuitMode::KillAll {
        std::process::exit(0);
    }

    Ok(())
}
