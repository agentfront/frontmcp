//! Metrics tab component
//!
//! Shows traffic and tool usage metrics.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::state::DashboardState;

/// Render the metrics tab
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    render_traffic_overview(frame, chunks[0], state);
    render_tool_usage(frame, chunks[1], state);
}

fn render_traffic_overview(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(vec![Span::styled(
        "TRAFFIC OVERVIEW",
        Style::default().fg(Color::Cyan).bold(),
    )]));
    lines.push(Line::from("─".repeat(30)));
    lines.push(Line::from(""));

    // Total requests
    lines.push(Line::from(vec![
        Span::raw("Total Requests:    "),
        Span::styled(
            format!("{:>8}", metrics.total_requests),
            Style::default().fg(Color::White).bold(),
        ),
    ]));

    // Successful requests
    lines.push(Line::from(vec![
        Span::raw("Successful:        "),
        Span::styled(
            format!("{:>8}", metrics.successful_requests),
            Style::default().fg(Color::Green),
        ),
        Span::styled(
            format!(" ({:.1}%)", metrics.success_rate()),
            Style::default().fg(Color::DarkGray),
        ),
    ]));

    // Failed requests
    lines.push(Line::from(vec![
        Span::raw("Failed:            "),
        Span::styled(
            format!("{:>8}", metrics.failed_requests),
            if metrics.failed_requests > 0 {
                Style::default().fg(Color::Red)
            } else {
                Style::default().fg(Color::DarkGray)
            },
        ),
    ]));

    lines.push(Line::from(""));

    // Average duration
    lines.push(Line::from(vec![
        Span::raw("Avg Duration:      "),
        Span::styled(
            format!("{:>6.1}ms", metrics.avg_duration_ms()),
            Style::default().fg(Color::Yellow),
        ),
    ]));

    // Total duration
    lines.push(Line::from(vec![
        Span::raw("Total Duration:    "),
        Span::styled(
            format!("{:>6}ms", metrics.total_duration_ms),
            Style::default().fg(Color::DarkGray),
        ),
    ]));

    lines.push(Line::from(""));
    lines.push(Line::from(""));

    // Visual bar for success rate
    if metrics.total_requests > 0 {
        let success_pct = metrics.success_rate();
        let bar_width = 20;
        let filled = ((success_pct / 100.0) * bar_width as f64) as usize;
        let empty = bar_width - filled;

        lines.push(Line::from(vec![
            Span::raw("Success Rate: "),
            Span::styled("█".repeat(filled), Style::default().fg(Color::Green)),
            Span::styled("░".repeat(empty), Style::default().fg(Color::DarkGray)),
            Span::raw(format!(" {:.1}%", success_pct)),
        ]));
    }

    let overview = Paragraph::new(lines).block(
        Block::default()
            .title(" Traffic ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(overview, area);
}

fn render_tool_usage(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(vec![Span::styled(
        "TOOL USAGE",
        Style::default().fg(Color::Cyan).bold(),
    )]));
    lines.push(Line::from("─".repeat(30)));
    lines.push(Line::from(""));

    if metrics.tool_usage.is_empty() {
        lines.push(Line::from(Span::styled(
            "No tool calls recorded yet",
            Style::default().fg(Color::DarkGray),
        )));
    } else {
        // Sort by usage count (descending)
        let mut usage: Vec<_> = metrics.tool_usage.iter().collect();
        usage.sort_by(|a, b| b.1.cmp(a.1));

        // Find max for bar scaling
        let max_count = usage.first().map(|(_, c)| **c).unwrap_or(1);

        for (name, count) in usage.iter().take(15) {
            let bar_width = 15;
            let filled = ((**count as f64 / max_count as f64) * bar_width as f64) as usize;
            let filled = filled.max(1); // At least 1 bar

            lines.push(Line::from(vec![
                Span::styled(
                    format!("{:>20}", if name.len() > 20 { &name[..20] } else { name }),
                    Style::default().fg(Color::White),
                ),
                Span::raw(" "),
                Span::styled("█".repeat(filled), Style::default().fg(Color::Cyan)),
                Span::raw(" "),
                Span::styled(count.to_string(), Style::default().fg(Color::DarkGray)),
            ]));
        }

        if usage.len() > 15 {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                format!("... and {} more tools", usage.len() - 15),
                Style::default().fg(Color::DarkGray),
            )));
        }
    }

    let tool_usage = Paragraph::new(lines).block(
        Block::default()
            .title(" Tool Usage ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(tool_usage, area);
}
