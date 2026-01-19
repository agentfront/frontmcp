//! Key hints bar component
//!
//! Shows available keyboard shortcuts at the bottom of the screen.

use ratatui::{prelude::*, widgets::Paragraph};

use crate::state::{DashboardState, FocusArea};

/// Render the key hints bar
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let hints = match state.focus {
        FocusArea::TabBar => vec![
            ("←/→", "Switch Tab"),
            ("↓/Enter", "Enter"),
            ("1-7", "Jump Tab"),
            ("o", "Overview"),
            ("?", "Help"),
            ("q", "Quit"),
            ("Ctrl+C", "Kill"),
        ],
        FocusArea::Overview => vec![
            ("↑/↓", "Scroll"),
            ("Esc/→", "Back"),
            ("PgUp/Dn", "Page"),
            ("?", "Help"),
        ],
        FocusArea::List => vec![
            ("↑/↓", "Navigate"),
            ("Enter", "Select"),
            ("Esc", "Back"),
            ("PgUp/Dn", "Page"),
            ("?", "Help"),
        ],
        FocusArea::Detail => vec![
            ("↑/↓", "Scroll"),
            ("Esc", "Back"),
            ("PgUp/Dn", "Page"),
            ("?", "Help"),
        ],
        FocusArea::SubTab => vec![
            ("←/→", "Switch"),
            ("↓/Enter", "Enter"),
            ("Esc", "Back"),
            ("?", "Help"),
        ],
        FocusArea::FilterInput => vec![
            ("Enter", "Apply"),
            ("Esc", "Back"),
            ("Backspace", "Clear"),
            ("?", "Help"),
        ],
    };

    let spans: Vec<Span> = hints
        .iter()
        .flat_map(|(key, desc)| {
            vec![
                Span::styled(
                    format!(" {key} "),
                    Style::default().fg(Color::Black).bg(Color::Gray),
                ),
                Span::raw(format!(" {desc} ")),
                Span::raw(" "),
            ]
        })
        .collect();

    let line = Line::from(spans);
    let widget = Paragraph::new(line)
        .style(Style::default().fg(Color::DarkGray))
        .alignment(Alignment::Center);

    frame.render_widget(widget, area);
}
