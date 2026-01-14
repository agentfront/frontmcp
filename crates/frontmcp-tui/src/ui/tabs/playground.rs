//! Playground tab component
//!
//! MCP client interface for testing (placeholder).

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::state::DashboardState;

/// Render the playground tab
pub fn render(frame: &mut Frame, area: Rect, _state: &DashboardState) {
    let content = r#"

    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║                    MCP Playground                        ║
    ║                                                          ║
    ║                   Coming Soon...                         ║
    ║                                                          ║
    ╠══════════════════════════════════════════════════════════╣
    ║                                                          ║
    ║   Test your MCP server with an interactive client        ║
    ║   interface directly from the terminal.                  ║
    ║                                                          ║
    ║   Features planned:                                      ║
    ║   • Call tools and view responses                        ║
    ║   • Read resources                                       ║
    ║   • Execute prompts                                      ║
    ║   • View raw JSON-RPC messages                           ║
    ║   • History of interactions                              ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝

"#;

    let placeholder = Paragraph::new(content)
        .block(
            Block::default()
                .title(" Playground ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);

    frame.render_widget(placeholder, area);
}
