//! AI Insight tab component
//!
//! Production readiness analysis (placeholder).

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::state::DashboardState;

/// Render the AI insight tab
pub fn render(frame: &mut Frame, area: Rect, _state: &DashboardState) {
    let content = r#"

    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║               AI Production Readiness                    ║
    ║                                                          ║
    ║                   Coming Soon...                         ║
    ║                                                          ║
    ╠══════════════════════════════════════════════════════════╣
    ║                                                          ║
    ║   Get AI-powered insights about your MCP server's        ║
    ║   production readiness and best practices.               ║
    ║                                                          ║
    ║   Features planned:                                      ║
    ║   • Security analysis                                    ║
    ║   • Performance recommendations                          ║
    ║   • Error handling coverage                              ║
    ║   • Documentation completeness                           ║
    ║   • Production readiness score                           ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝

"#;

    let placeholder = Paragraph::new(content)
        .block(
            Block::default()
                .title(" AI Insight ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);

    frame.render_widget(placeholder, area);
}
