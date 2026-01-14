//! Quit confirmation dialog
//!
//! Shows a modal asking if the user wants to kill the server process.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Clear, Paragraph},
};

/// Render the quit confirmation dialog
pub fn render(frame: &mut Frame, area: Rect) {
    // Small centered dialog
    let dialog_width = 34;
    let dialog_height = 5;
    let dialog_x = (area.width.saturating_sub(dialog_width)) / 2;
    let dialog_y = (area.height.saturating_sub(dialog_height)) / 2;

    let dialog_area = Rect::new(dialog_x, dialog_y, dialog_width, dialog_height);

    // Clear the area behind the dialog
    frame.render_widget(Clear, dialog_area);

    let content = Line::from(vec![
        Span::raw("  "),
        Span::styled("[Y]", Style::default().fg(Color::Green).bold()),
        Span::raw(" Yes    "),
        Span::styled("[N]", Style::default().fg(Color::Red).bold()),
        Span::raw(" No  "),
    ]);

    let dialog = Paragraph::new(vec![
        Line::from(""),
        Line::from(Span::styled(
            "   Kill server process?",
            Style::default().fg(Color::Yellow).bold(),
        )),
        Line::from(""),
        content,
    ])
    .block(
        Block::default()
            .title(" Quit ")
            .title_style(Style::default().fg(Color::Yellow).bold())
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Yellow)),
    )
    .alignment(Alignment::Center);

    frame.render_widget(dialog, dialog_area);
}
