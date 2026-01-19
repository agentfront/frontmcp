//! Sessions tab component
//!
//! Shows active transport sessions and their logs.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap},
};

use crate::state::{DashboardState, FocusArea, LogLevel};

/// Render the sessions tab
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    // Split into list and detail panels
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(area);

    render_session_list(frame, chunks[0], state);
    render_session_detail(frame, chunks[1], state);
}

fn render_session_list(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let sessions: Vec<_> = state.sessions.values().collect();
    let total_sessions = sessions.len();

    // Calculate visible height (inside borders)
    let visible_height = area.height.saturating_sub(2) as usize;

    // Calculate scroll offset to keep selected item visible
    let scroll_offset = if total_sessions <= visible_height {
        0
    } else if state.list_selected < state.list_scroll {
        state.list_selected
    } else if state.list_selected >= state.list_scroll + visible_height {
        state.list_selected.saturating_sub(visible_height) + 1
    } else {
        state.list_scroll
    };

    let items: Vec<ListItem> = sessions
        .iter()
        .enumerate()
        .skip(scroll_offset)
        .take(visible_height)
        .map(|(idx, s)| {
            let status = if s.is_active { "●" } else { "○" };
            let status_style = if s.is_active {
                Style::default().fg(Color::Green)
            } else {
                Style::default().fg(Color::DarkGray)
            };

            // Priority: auth_user_name > client_name > user_agent > "Anonymous"
            let client = s.auth_user_name.as_deref()
                .or(s.client_name.as_deref())
                .or(s.user_agent.as_deref())
                .unwrap_or("Anonymous");
            let transport = s.transport_type.as_deref().unwrap_or("?");
            let id_short = &s.id[..8.min(s.id.len())];

            // Auth badge
            let (auth_badge, auth_color) = match s.auth_mode.as_deref() {
                Some("public") => ("[P]", Color::DarkGray),
                Some("transparent") => ("[T]", Color::Blue),
                Some("orchestrated") => ("[O]", Color::Magenta),
                _ => {
                    if s.is_anonymous == Some(true) {
                        ("[A]", Color::DarkGray)
                    } else {
                        ("", Color::DarkGray)
                    }
                }
            };

            let is_selected = idx == state.list_selected && state.focus == FocusArea::List;
            let style = if is_selected {
                Style::default().bg(Color::DarkGray).fg(Color::White)
            } else {
                Style::default()
            };

            let mut spans = vec![
                Span::styled(status, status_style),
                Span::raw(" "),
            ];
            if !auth_badge.is_empty() {
                spans.push(Span::styled(auth_badge, Style::default().fg(auth_color)));
                spans.push(Span::raw(" "));
            }
            spans.push(Span::styled(client, Style::default().fg(Color::White)));
            spans.push(Span::raw(" "));
            spans.push(Span::styled(format!("({transport})"), Style::default().fg(Color::DarkGray)));
            spans.push(Span::raw(" "));
            spans.push(Span::styled(id_short, Style::default().fg(Color::DarkGray)));

            ListItem::new(Line::from(spans)).style(style)
        })
        .collect();

    let border_style = if state.focus == FocusArea::List {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let list = List::new(items).block(
        Block::default()
            .title(format!(" Sessions ({}) ", total_sessions))
            .borders(Borders::ALL)
            .border_style(border_style),
    );

    frame.render_widget(list, area);

    // Render scrollbar if needed
    if total_sessions > visible_height {
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .begin_symbol(Some("▲"))
            .end_symbol(Some("▼"));

        let mut scrollbar_state = ScrollbarState::new(total_sessions)
            .position(scroll_offset);

        let scrollbar_area = Rect {
            x: area.x + area.width - 1,
            y: area.y + 1,
            width: 1,
            height: area.height.saturating_sub(2),
        };

        frame.render_stateful_widget(scrollbar, scrollbar_area, &mut scrollbar_state);
    }
}

fn render_session_detail(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let border_style = if state.focus == FocusArea::Detail {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    // If a session is selected, show its details and logs
    if let Some(ref selected_id) = state.selected_session {
        if let Some(session) = state.sessions.get(selected_id) {
            let mut lines: Vec<Line> = Vec::new();

            // Session info header
            lines.push(Line::from(vec![
                Span::styled("Session ID: ", Style::default().fg(Color::DarkGray)),
                Span::styled(&session.id, Style::default().fg(Color::White)),
            ]));

            lines.push(Line::from(vec![
                Span::styled("Transport: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    session.transport_type.as_deref().unwrap_or("unknown"),
                    Style::default().fg(Color::Cyan),
                ),
            ]));

            // Client info with user agent fallback
            let client_name = session.client_name.as_deref()
                .or(session.user_agent.as_deref())
                .unwrap_or("Anonymous");
            lines.push(Line::from(vec![
                Span::styled("Client: ", Style::default().fg(Color::DarkGray)),
                Span::styled(
                    client_name,
                    Style::default().fg(Color::White),
                ),
                Span::raw(" v"),
                Span::styled(
                    session.client_version.as_deref().unwrap_or("?"),
                    Style::default().fg(Color::White),
                ),
            ]));

            // Show user agent separately if different from client name
            if let Some(ua) = &session.user_agent {
                if session.client_name.as_deref() != Some(ua.as_str()) {
                    lines.push(Line::from(vec![
                        Span::styled("User Agent: ", Style::default().fg(Color::DarkGray)),
                        Span::styled(ua.as_str(), Style::default().fg(Color::DarkGray)),
                    ]));
                }
            }

            let status = if session.is_active { "Active" } else { "Disconnected" };
            let status_style = if session.is_active {
                Style::default().fg(Color::Green)
            } else {
                Style::default().fg(Color::Red)
            };
            lines.push(Line::from(vec![
                Span::styled("Status: ", Style::default().fg(Color::DarkGray)),
                Span::styled(status, status_style),
            ]));

            // Auth information
            if session.auth_mode.is_some() || session.auth_user_name.is_some() || session.is_anonymous.is_some() {
                lines.push(Line::from(""));
                lines.push(Line::from(Span::styled(
                    "─ Authentication ─",
                    Style::default().fg(Color::Magenta),
                )));

                // Auth mode
                if let Some(mode) = &session.auth_mode {
                    let (mode_display, mode_color) = match mode.as_str() {
                        "public" => ("Public", Color::DarkGray),
                        "transparent" => ("Transparent", Color::Blue),
                        "orchestrated" => ("Orchestrated", Color::Magenta),
                        _ => (mode.as_str(), Color::White),
                    };
                    lines.push(Line::from(vec![
                        Span::styled("Mode: ", Style::default().fg(Color::DarkGray)),
                        Span::styled(mode_display, Style::default().fg(mode_color)),
                    ]));
                }

                // User info
                if let Some(name) = &session.auth_user_name {
                    lines.push(Line::from(vec![
                        Span::styled("User: ", Style::default().fg(Color::DarkGray)),
                        Span::styled(name, Style::default().fg(Color::White)),
                    ]));
                }
                if let Some(email) = &session.auth_user_email {
                    lines.push(Line::from(vec![
                        Span::styled("Email: ", Style::default().fg(Color::DarkGray)),
                        Span::styled(email, Style::default().fg(Color::DarkGray)),
                    ]));
                }

                // Anonymous status
                if session.is_anonymous == Some(true) {
                    lines.push(Line::from(vec![
                        Span::styled("Anonymous: ", Style::default().fg(Color::DarkGray)),
                        Span::styled("Yes", Style::default().fg(Color::Yellow)),
                    ]));
                }
            }

            lines.push(Line::from(""));
            lines.push(Line::from(Span::styled(
                "─ Session Logs ─",
                Style::default().fg(Color::Cyan),
            )));
            lines.push(Line::from(""));

            // Session-specific logs (show all, not just 20)
            let session_logs = state.selected_session_logs();
            if session_logs.is_empty() {
                lines.push(Line::from(Span::styled(
                    "No logs for this session",
                    Style::default().fg(Color::DarkGray),
                )));
            } else {
                for log in session_logs.iter().rev() {
                    let level_style = match log.level {
                        LogLevel::Error => Style::default().fg(Color::Red),
                        LogLevel::Warn => Style::default().fg(Color::Yellow),
                        LogLevel::Info => Style::default().fg(Color::White),
                        LogLevel::Debug => Style::default().fg(Color::DarkGray),
                    };
                    let prefix = match log.level {
                        LogLevel::Error => "ERR",
                        LogLevel::Warn => "WRN",
                        LogLevel::Info => "INF",
                        LogLevel::Debug => "DBG",
                    };
                    lines.push(Line::from(vec![
                        Span::styled(format!("[{prefix}] "), level_style),
                        Span::raw(&log.message),
                    ]));
                }
            }

            let content_height = lines.len();
            let visible_height = area.height.saturating_sub(2) as usize;
            let max_scroll = content_height.saturating_sub(visible_height);
            let scroll_offset = state.detail_scroll.min(max_scroll);

            let detail = Paragraph::new(lines)
                .block(
                    Block::default()
                        .title(" Session Details ")
                        .borders(Borders::ALL)
                        .border_style(border_style),
                )
                .wrap(Wrap { trim: false })
                .scroll((scroll_offset as u16, 0));

            frame.render_widget(detail, area);

            // Render scrollbar if content exceeds visible area
            if content_height > visible_height {
                let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
                    .begin_symbol(Some("▲"))
                    .end_symbol(Some("▼"));
                let mut scrollbar_state = ScrollbarState::new(content_height).position(scroll_offset);
                frame.render_stateful_widget(
                    scrollbar,
                    area.inner(Margin { vertical: 1, horizontal: 0 }),
                    &mut scrollbar_state,
                );
            }
            return;
        }
    }

    // No session selected - show placeholder
    let sessions: Vec<_> = state.sessions.values().collect();
    let content = if let Some(session) = sessions.get(state.list_selected) {
        format!(
            "Session: {}\n\nTransport: {}\nClient: {} v{}\nConnected: {}\nActive: {}\n\nPress Enter to view session logs",
            session.id,
            session.transport_type.as_deref().unwrap_or("unknown"),
            session.client_name.as_deref().unwrap_or("unknown"),
            session.client_version.as_deref().unwrap_or("unknown"),
            session.connected_at,
            if session.is_active { "Yes" } else { "No" }
        )
    } else {
        "No sessions connected\n\nConnect an MCP client to see sessions here.".to_string()
    };

    let detail = Paragraph::new(content)
        .block(
            Block::default()
                .title(" Details ")
                .borders(Borders::ALL)
                .border_style(border_style),
        )
        .wrap(Wrap { trim: true });

    frame.render_widget(detail, area);
}
