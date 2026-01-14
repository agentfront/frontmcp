//! Help overlay component
//!
//! Shows a modal with all available keyboard shortcuts.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

/// Render the help overlay
pub fn render(frame: &mut Frame, area: Rect) {
    // Calculate centered popup area (60% width, 70% height)
    let popup_width = (area.width as f32 * 0.6) as u16;
    let popup_height = (area.height as f32 * 0.7) as u16;
    let popup_x = (area.width - popup_width) / 2;
    let popup_y = (area.height - popup_height) / 2;

    let popup_area = Rect::new(popup_x, popup_y, popup_width, popup_height);

    // Clear the area behind the popup
    frame.render_widget(Clear, popup_area);

    let help_text = r#"
  FrontMCP TUI - Keyboard Shortcuts
  ═══════════════════════════════════════

  Navigation
  ──────────────────────────────────────
  ←/→              Navigate tabs / sub-tabs
  ↑/↓              Navigate lists / scroll
  Enter / Space    Select / activate item
  Esc              Go back to parent level
  1-6              Jump directly to tab

  Page Navigation
  ──────────────────────────────────────
  Page Up/Down     Page through lists
  Home / End       Jump to start/end

  Focus Levels
  ──────────────────────────────────────
  Tab Bar    →  Tab Content  →  Detail View
     ↑              ↓              ↓
     └──────────── Esc ───────────┘

  General
  ──────────────────────────────────────
  Ctrl+C           Kill server & exit
  q                Quit (with confirmation)
  ?                Toggle this help

  ──────────────────────────────────────
  Press any key to close this help
"#;

    let help_widget = Paragraph::new(help_text)
        .block(
            Block::default()
                .title(" Help ")
                .title_style(Style::default().fg(Color::Cyan).bold())
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .style(Style::default().fg(Color::White))
        .wrap(Wrap { trim: false });

    frame.render_widget(help_widget, popup_area);
}
