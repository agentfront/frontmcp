//! Logs tab component
//!
//! Shows scrollable logs with colors.
//! Newest logs appear at the bottom (live tail behavior).

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
};

use crate::state::{DashboardState, FocusArea, LogLevel};

/// Render the logs tab
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let logs = state.filtered_logs();

    // Build log content with colors - newest at bottom (chronological order)
    let mut lines: Vec<Line> = Vec::new();

    for log in logs.iter() {
        let (level_style, level_prefix) = match log.level {
            LogLevel::Error => (Style::default().fg(Color::Red).bold(), "ERROR"),
            LogLevel::Warn => (Style::default().fg(Color::Yellow), "WARN "),
            LogLevel::Info => (Style::default().fg(Color::White), "INFO "),
            LogLevel::Debug => (Style::default().fg(Color::DarkGray), "DEBUG"),
        };

        // Build the log line - just level prefix and message (no source for cleaner look)
        let line = Line::from(vec![
            Span::styled(format!("[{}]", level_prefix), level_style),
            Span::raw(" "),
            Span::styled(&log.message, Style::default().fg(match log.level {
                LogLevel::Error => Color::Red,
                LogLevel::Warn => Color::Yellow,
                LogLevel::Info => Color::White,
                LogLevel::Debug => Color::DarkGray,
            })),
        ]);

        lines.push(line);
    }

    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "No logs yet. Waiting for server output...",
            Style::default().fg(Color::DarkGray),
        )));
    }

    let border_style = if state.focus == FocusArea::List || state.focus == FocusArea::Detail {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    // Calculate visible area height (inside borders: top border + bottom border = 2)
    let visible_height = area.height.saturating_sub(2) as usize;
    let total_lines = lines.len();

    // Calculate scroll offset
    // list_scroll = 0 means "live tail" (auto-scroll to bottom)
    // list_scroll > 0 means user scrolled up N lines from the bottom
    let max_scroll_offset = total_lines.saturating_sub(visible_height);
    let scroll_offset = if state.list_scroll == 0 {
        // Live tail mode: show bottom of logs
        max_scroll_offset
    } else {
        // User scrolled: show position relative to bottom
        max_scroll_offset.saturating_sub(state.list_scroll)
    };

    let logs_widget = Paragraph::new(lines)
        .block(
            Block::default()
                .title(format!(" Logs ({}) ", total_lines))
                .borders(Borders::ALL)
                .border_style(border_style),
        )
        .scroll((scroll_offset as u16, 0));

    frame.render_widget(logs_widget, area);

    // Render scrollbar
    if total_lines > visible_height {
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .begin_symbol(Some("▲"))
            .end_symbol(Some("▼"));

        let mut scrollbar_state = ScrollbarState::new(total_lines)
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
