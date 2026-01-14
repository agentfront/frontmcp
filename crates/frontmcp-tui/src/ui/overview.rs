//! Overview panel component
//!
//! Always-visible panel showing server stats, sessions, and recent tool calls.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::state::DashboardState;

/// Render the overview panel
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let mut lines: Vec<Line> = Vec::new();

    // Server section
    lines.push(Line::from(vec![
        Span::styled("SERVER", Style::default().fg(Color::Cyan).bold()),
    ]));
    lines.push(Line::from("─".repeat(area.width.saturating_sub(4) as usize)));

    // Server status
    let status_style = if state.server.is_ready {
        Style::default().fg(Color::Green)
    } else if state.server.error.is_some() {
        Style::default().fg(Color::Red)
    } else {
        Style::default().fg(Color::Yellow)
    };

    let status_icon = if state.server.is_ready { "●" } else { "○" };
    let status_text = if state.server.is_ready {
        "Ready"
    } else if state.server.error.is_some() {
        "Error"
    } else {
        "Starting"
    };

    lines.push(Line::from(vec![
        Span::raw("Status: "),
        Span::styled(format!("{status_icon} {status_text}"), status_style),
    ]));

    // Server address/port
    if let Some(ref addr) = state.overview.server_address {
        lines.push(Line::from(vec![
            Span::raw("Address: "),
            Span::styled(addr.as_str(), Style::default().fg(Color::White)),
        ]));
    }

    if let Some(port) = state.overview.server_port {
        lines.push(Line::from(vec![
            Span::raw("Port: "),
            Span::styled(port.to_string(), Style::default().fg(Color::White)),
        ]));
    }

    // Debug: show pipe connection status and events received
    let pipe_icon = if state.pipe_connected { "●" } else { "○" };
    let pipe_style = if state.pipe_connected {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::Red)
    };

    lines.push(Line::from(vec![
        Span::raw("Pipe: "),
        Span::styled(pipe_icon, pipe_style),
        Span::raw(" "),
        Span::styled(
            if state.pipe_connected { "Connected" } else { "Waiting" },
            pipe_style,
        ),
    ]));

    // Show pipe file path (truncated)
    if let Some(ref path) = state.pipe_path {
        let display_path = if path.len() > 30 {
            format!("...{}", &path[path.len()-30..])
        } else {
            path.clone()
        };
        lines.push(Line::from(vec![
            Span::styled(display_path, Style::default().fg(Color::DarkGray)),
        ]));
    }

    lines.push(Line::from(vec![
        Span::raw("Lines: "),
        Span::styled(
            state.lines_read.to_string(),
            Style::default().fg(Color::Yellow),
        ),
        Span::raw(" → Events: "),
        Span::styled(
            state.events_received.to_string(),
            Style::default().fg(Color::Green),
        ),
    ]));

    if state.parse_failures > 0 {
        lines.push(Line::from(vec![
            Span::raw("Parse fails: "),
            Span::styled(
                state.parse_failures.to_string(),
                Style::default().fg(Color::Red),
            ),
        ]));
    }

    lines.push(Line::from(""));

    // Stats section
    lines.push(Line::from(vec![
        Span::styled("STATS", Style::default().fg(Color::Cyan).bold()),
    ]));
    lines.push(Line::from("─".repeat(area.width.saturating_sub(4) as usize)));

    // Apps and scopes
    lines.push(Line::from(vec![
        Span::raw("Apps: "),
        Span::styled(
            state.overview.registered_apps.to_string(),
            Style::default().fg(Color::White),
        ),
    ]));

    lines.push(Line::from(vec![
        Span::raw("Scopes: "),
        Span::styled(
            state.overview.scope_count.to_string(),
            Style::default().fg(Color::White),
        ),
    ]));

    // Sessions
    lines.push(Line::from(vec![
        Span::raw("Sessions: "),
        Span::styled(
            format!(
                "{}/{}",
                state.overview.active_sessions, state.overview.total_sessions
            ),
            Style::default().fg(Color::Green),
        ),
        Span::raw(" active"),
    ]));

    // Registry counts
    lines.push(Line::from(vec![
        Span::raw("Tools: "),
        Span::styled(
            state.tools.len().to_string(),
            Style::default().fg(Color::White),
        ),
    ]));

    lines.push(Line::from(vec![
        Span::raw("Resources: "),
        Span::styled(
            state.resources.len().to_string(),
            Style::default().fg(Color::White),
        ),
    ]));

    lines.push(Line::from(vec![
        Span::raw("Prompts: "),
        Span::styled(
            state.prompts.len().to_string(),
            Style::default().fg(Color::White),
        ),
    ]));

    lines.push(Line::from(""));

    // Recent tool calls
    lines.push(Line::from(vec![
        Span::styled("RECENT CALLS", Style::default().fg(Color::Cyan).bold()),
    ]));
    lines.push(Line::from("─".repeat(area.width.saturating_sub(4) as usize)));

    if state.overview.last_tool_calls.is_empty() {
        lines.push(Line::from(Span::styled(
            "No tool calls yet",
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        for call in state.overview.last_tool_calls.iter().take(5) {
            let icon = if call.success { "●" } else { "●" };
            let icon_style = if call.success {
                Style::default().fg(Color::Green)
            } else {
                Style::default().fg(Color::Red)
            };

            let duration = call
                .duration_ms
                .map(|d| format!(" ({d}ms)"))
                .unwrap_or_default();

            lines.push(Line::from(vec![
                Span::styled(icon, icon_style),
                Span::raw(" "),
                Span::styled(&call.name, Style::default().fg(Color::White)),
                Span::styled(duration, Style::default().fg(Color::DarkGray)),
            ]));
        }
    }

    lines.push(Line::from(""));

    // Metrics summary
    if state.metrics.total_requests > 0 {
        lines.push(Line::from(vec![
            Span::styled("METRICS", Style::default().fg(Color::Cyan).bold()),
        ]));
        lines.push(Line::from("─".repeat(area.width.saturating_sub(4) as usize)));

        lines.push(Line::from(vec![
            Span::raw("Requests: "),
            Span::styled(
                state.metrics.total_requests.to_string(),
                Style::default().fg(Color::White),
            ),
        ]));

        lines.push(Line::from(vec![
            Span::raw("Success: "),
            Span::styled(
                format!("{:.1}%", state.metrics.success_rate()),
                Style::default().fg(Color::Green),
            ),
        ]));

        lines.push(Line::from(vec![
            Span::raw("Avg time: "),
            Span::styled(
                format!("{:.1}ms", state.metrics.avg_duration_ms()),
                Style::default().fg(Color::White),
            ),
        ]));
    }

    let overview = Paragraph::new(lines).block(
        Block::default()
            .title(" Overview ")
            .title_style(Style::default().fg(Color::Cyan).bold())
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(overview, area);
}
