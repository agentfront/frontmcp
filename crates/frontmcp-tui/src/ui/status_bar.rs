//! Status bar component
//!
//! Shows server status, address, and session indicators.

use ratatui::{prelude::*, widgets::Paragraph};

use crate::state::DashboardState;

/// Render the status bar
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Length(18), // Server status
            Constraint::Min(0),     // Server address
            Constraint::Length(25), // Session count
        ])
        .split(area);

    // Server status indicator
    let (status_icon, status_text, status_style) = if state.server.is_ready {
        (
            "●",
            "Server Ready",
            Style::default().fg(Color::Green).bold(),
        )
    } else if state.connection_error.is_some() {
        (
            "●",
            "Connection Error",
            Style::default().fg(Color::Red).bold(),
        )
    } else if state.server.error.is_some() {
        ("●", "Server Error", Style::default().fg(Color::Red).bold())
    } else {
        (
            "○",
            "Starting",
            Style::default().fg(Color::Yellow),
        )
    };

    let server_status = Paragraph::new(Line::from(vec![
        Span::raw(" "),
        Span::styled(status_icon, status_style),
        Span::raw(" "),
        Span::styled(status_text, status_style),
    ]));
    frame.render_widget(server_status, chunks[0]);

    // Server address (center)
    if let Some(ref addr) = state.server.address {
        let address_widget = Paragraph::new(addr.as_str())
            .style(Style::default().fg(Color::White))
            .alignment(Alignment::Center);
        frame.render_widget(address_widget, chunks[1]);
    }

    // Session count (right)
    let active_sessions = state.overview.active_sessions;
    let total_sessions = state.overview.total_sessions;
    let session_text = format!("Sessions: {active_sessions}/{total_sessions} active ");
    let session_widget = Paragraph::new(session_text)
        .style(Style::default().fg(Color::Cyan))
        .alignment(Alignment::Right);
    frame.render_widget(session_widget, chunks[2]);
}
