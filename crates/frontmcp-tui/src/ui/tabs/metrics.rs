//! Metrics tab component
//!
//! Shows system metrics, traffic, AI tokens, and tool usage in a 4-panel layout.

use ratatui::{
    prelude::*,
    symbols,
    widgets::{Axis, Block, Borders, Chart, Dataset, GraphType, Paragraph},
};

use crate::state::DashboardState;

/// Format bytes in human-readable format
fn format_bytes(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.1} GB", bytes as f64 / 1_000_000_000.0)
    } else if bytes >= 1_000_000 {
        format!("{:.1} MB", bytes as f64 / 1_000_000.0)
    } else if bytes >= 1_000 {
        format!("{:.1} KB", bytes as f64 / 1_000.0)
    } else {
        format!("{} B", bytes)
    }
}

/// Render the metrics tab
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    // Layout: System chart (40% height), then traffic/tokens/tools (60% height, 3 columns)
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(45), Constraint::Percentage(55)])
        .split(area);

    // Top row: System charts (CPU + Memory side by side)
    let top_cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(rows[0]);

    render_cpu_chart(frame, top_cols[0], state);
    render_memory_chart(frame, top_cols[1], state);

    // Bottom row: Traffic, Tokens, Tool Usage
    let bottom_cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(33), Constraint::Percentage(34), Constraint::Percentage(33)])
        .split(rows[1]);

    render_traffic_panel(frame, bottom_cols[0], state);
    render_tokens_panel(frame, bottom_cols[1], state);
    render_tool_usage_panel(frame, bottom_cols[2], state);
}

/// Render CPU panel with current value display and chart
fn render_cpu_chart(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    // Split area: value display (3 lines) + chart
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Fill(1)])
        .split(area);

    // Render current value display
    let cpu_color = if metrics.current_cpu > 80.0 {
        Color::Red
    } else if metrics.current_cpu > 50.0 {
        Color::Yellow
    } else {
        Color::Green
    };

    let value_content = Line::from(vec![
        Span::styled("CPU: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("{:.1}%", metrics.current_cpu),
            Style::default().fg(cpu_color).bold(),
        ),
    ]);

    let value_widget = Paragraph::new(value_content)
        .block(
            Block::default()
                .borders(Borders::TOP | Borders::LEFT | Borders::RIGHT)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(" CPU ")
                .title_style(Style::default().fg(Color::Cyan).bold()),
        )
        .alignment(Alignment::Center);

    frame.render_widget(value_widget, chunks[0]);

    // Render chart
    let cpu_data: Vec<(f64, f64)> = metrics
        .cpu_history
        .iter()
        .enumerate()
        .map(|(i, &v)| (i as f64, v as f64))
        .collect();

    let datasets = vec![Dataset::default()
        .marker(symbols::Marker::Braille)
        .style(Style::default().fg(cpu_color))
        .graph_type(GraphType::Line)
        .data(&cpu_data)];

    let x_max = (metrics.cpu_history.len().max(1) - 1) as f64;

    let chart = Chart::new(datasets)
        .block(
            Block::default()
                .borders(Borders::BOTTOM | Borders::LEFT | Borders::RIGHT)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .x_axis(
            Axis::default()
                .style(Style::default().fg(Color::DarkGray))
                .bounds([0.0, x_max.max(60.0)])
                .labels(vec![Line::from("60s"), Line::from("30s"), Line::from("now")]),
        )
        .y_axis(
            Axis::default()
                .style(Style::default().fg(Color::DarkGray))
                .bounds([0.0, 100.0])
                .labels(vec![Line::from("0"), Line::from("50"), Line::from("100")]),
        );

    frame.render_widget(chart, chunks[1]);
}

/// Render Memory panel with current value display and chart
fn render_memory_chart(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    // Split area: value display (3 lines) + chart
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Fill(1)])
        .split(area);

    // Render current value display
    let value_content = Line::from(vec![
        Span::styled("Memory: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format_bytes(metrics.current_memory),
            Style::default().fg(Color::Magenta).bold(),
        ),
    ]);

    let value_widget = Paragraph::new(value_content)
        .block(
            Block::default()
                .borders(Borders::TOP | Borders::LEFT | Borders::RIGHT)
                .border_style(Style::default().fg(Color::DarkGray))
                .title(" Memory ")
                .title_style(Style::default().fg(Color::Cyan).bold()),
        )
        .alignment(Alignment::Center);

    frame.render_widget(value_widget, chunks[0]);

    // Render chart
    let max_mem = metrics
        .memory_history
        .iter()
        .max()
        .copied()
        .unwrap_or(1)
        .max(1);

    let mem_data: Vec<(f64, f64)> = metrics
        .memory_history
        .iter()
        .enumerate()
        .map(|(i, &v)| (i as f64, (v as f64 / 1_000_000.0))) // Convert to MB
        .collect();

    let max_mem_mb = max_mem as f64 / 1_000_000.0;
    let y_bound = (max_mem_mb * 1.2).max(100.0); // 20% headroom, min 100MB

    let datasets = vec![Dataset::default()
        .marker(symbols::Marker::Braille)
        .style(Style::default().fg(Color::Magenta))
        .graph_type(GraphType::Line)
        .data(&mem_data)];

    let x_max = (metrics.memory_history.len().max(1) - 1) as f64;

    let chart = Chart::new(datasets)
        .block(
            Block::default()
                .borders(Borders::BOTTOM | Borders::LEFT | Borders::RIGHT)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .x_axis(
            Axis::default()
                .style(Style::default().fg(Color::DarkGray))
                .bounds([0.0, x_max.max(60.0)])
                .labels(vec![Line::from("60s"), Line::from("30s"), Line::from("now")]),
        )
        .y_axis(
            Axis::default()
                .style(Style::default().fg(Color::DarkGray))
                .bounds([0.0, y_bound])
                .labels(vec![
                    Line::from("0"),
                    Line::from(format!("{:.0}", y_bound / 2.0)),
                    Line::from(format!("{:.0}", y_bound)),
                ]),
        );

    frame.render_widget(chart, chunks[1]);
}

/// Render the traffic panel (inbound/outbound bytes)
fn render_traffic_panel(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(vec![Span::styled(
        "TRAFFIC",
        Style::default().fg(Color::Cyan).bold(),
    )]));
    lines.push(Line::from(""));

    // Inbound
    lines.push(Line::from(vec![
        Span::raw("Inbound:   "),
        Span::styled(
            format!("{:>10}", format_bytes(metrics.inbound_bytes)),
            Style::default().fg(Color::Green).bold(),
        ),
        Span::styled(
            format!("  ({} req)", metrics.total_requests),
            Style::default().fg(Color::DarkGray),
        ),
    ]));

    // Outbound
    lines.push(Line::from(vec![
        Span::raw("Outbound:  "),
        Span::styled(
            format!("{:>10}", format_bytes(metrics.outbound_bytes)),
            Style::default().fg(Color::Yellow).bold(),
        ),
    ]));

    lines.push(Line::from(""));

    // Average sizes
    let avg_in = metrics.avg_inbound_bytes();
    let avg_out = metrics.avg_outbound_bytes();
    lines.push(Line::from(vec![
        Span::raw("Avg Size:  "),
        Span::styled(
            format!("{}", format_bytes(avg_in as u64)),
            Style::default().fg(Color::Green),
        ),
        Span::raw(" / "),
        Span::styled(
            format!("{}", format_bytes(avg_out as u64)),
            Style::default().fg(Color::Yellow),
        ),
    ]));

    lines.push(Line::from(""));

    // Success/failure counts
    lines.push(Line::from(vec![
        Span::raw("Success:   "),
        Span::styled(
            format!("{:>6}", metrics.successful_requests),
            Style::default().fg(Color::Green),
        ),
        Span::styled(
            format!(" ({:.1}%)", metrics.success_rate()),
            Style::default().fg(Color::DarkGray),
        ),
    ]));

    lines.push(Line::from(vec![
        Span::raw("Failed:    "),
        Span::styled(
            format!("{:>6}", metrics.failed_requests),
            if metrics.failed_requests > 0 {
                Style::default().fg(Color::Red)
            } else {
                Style::default().fg(Color::DarkGray)
            },
        ),
    ]));

    let panel = Paragraph::new(lines).block(
        Block::default()
            .title(" Traffic ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(panel, area);
}

/// Render the AI tokens panel
fn render_tokens_panel(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(vec![Span::styled(
        "AI TOKENS",
        Style::default().fg(Color::Cyan).bold(),
    )]));
    lines.push(Line::from(""));

    // Total tokens
    lines.push(Line::from(vec![
        Span::raw("Total:       "),
        Span::styled(
            format!("{:>12} tokens", format_number(metrics.total_tokens)),
            Style::default().fg(Color::White).bold(),
        ),
    ]));

    // Prompt tokens
    lines.push(Line::from(vec![
        Span::raw("Prompt:      "),
        Span::styled(
            format!("{:>12}", format_number(metrics.prompt_tokens)),
            Style::default().fg(Color::Blue),
        ),
    ]));

    // Completion tokens
    lines.push(Line::from(vec![
        Span::raw("Completion:  "),
        Span::styled(
            format!("{:>12}", format_number(metrics.completion_tokens)),
            Style::default().fg(Color::Green),
        ),
    ]));

    lines.push(Line::from(""));

    // Estimated cost (rough estimate: $0.01 per 1000 tokens average)
    let est_cost = metrics.total_tokens as f64 / 1000.0 * 0.01;
    lines.push(Line::from(vec![
        Span::raw("Est. Cost:   "),
        Span::styled(
            format!("${:>11.4}", est_cost),
            Style::default().fg(Color::Yellow),
        ),
    ]));

    lines.push(Line::from(""));
    lines.push(Line::from(""));

    // Placeholder message if no tokens tracked
    if metrics.total_tokens == 0 {
        lines.push(Line::from(Span::styled(
            "Token tracking not yet enabled",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let panel = Paragraph::new(lines).block(
        Block::default()
            .title(" AI Tokens ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(panel, area);
}

/// Render the tool usage panel with bar chart
fn render_tool_usage_panel(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let metrics = &state.metrics;

    let mut lines: Vec<Line> = Vec::new();

    lines.push(Line::from(vec![Span::styled(
        "TOOL USAGE",
        Style::default().fg(Color::Cyan).bold(),
    )]));
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

        // Calculate available width for tool name (area width minus borders, bar, count, spacing)
        let available_width = area.width.saturating_sub(25) as usize;
        let name_width = available_width.min(18).max(8);

        for (name, count) in usage.iter().take(10) {
            let bar_width = 10;
            let filled = ((**count as f64 / max_count as f64) * bar_width as f64) as usize;
            let filled = filled.max(1); // At least 1 bar

            // Truncate name if needed
            let display_name = if name.len() > name_width {
                format!("{}…", &name[..name_width - 1])
            } else {
                format!("{:width$}", name, width = name_width)
            };

            lines.push(Line::from(vec![
                Span::styled(display_name, Style::default().fg(Color::White)),
                Span::raw(" "),
                Span::styled("█".repeat(filled), Style::default().fg(Color::Cyan)),
                Span::raw(" "),
                Span::styled(
                    format!("{:>4}", count),
                    Style::default().fg(Color::DarkGray),
                ),
            ]));
        }

        if usage.len() > 10 {
            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                format!("... and {} more", usage.len() - 10),
                Style::default().fg(Color::DarkGray),
            )));
        }
    }

    let panel = Paragraph::new(lines).block(
        Block::default()
            .title(" Tool Usage ")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::DarkGray)),
    );

    frame.render_widget(panel, area);
}

/// Format a number with comma separators for readability
fn format_number(n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let s = n.to_string();
    let mut result = String::new();
    for (i, c) in s.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result.chars().rev().collect()
}
