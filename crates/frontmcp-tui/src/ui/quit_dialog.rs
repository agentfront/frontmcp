//! Quit confirmation dialog
//!
//! Shows a modal asking if the user wants to kill the server process.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Clear, Paragraph},
};

use crate::state::QuitDialogSelection;

/// Render the quit confirmation dialog
pub fn render(frame: &mut Frame, area: Rect, selection: QuitDialogSelection) {
    // Small centered dialog
    let dialog_width = 38;
    let dialog_height = 7;
    let dialog_x = (area.width.saturating_sub(dialog_width)) / 2;
    let dialog_y = (area.height.saturating_sub(dialog_height)) / 2;

    let dialog_area = Rect::new(dialog_x, dialog_y, dialog_width, dialog_height);

    // Clear the area behind the dialog
    frame.render_widget(Clear, dialog_area);

    // Button styles based on selection
    let (cancel_style, kill_style) = match selection {
        QuitDialogSelection::Cancel => (
            Style::default().fg(Color::Black).bg(Color::White).bold(),
            Style::default().fg(Color::Red),
        ),
        QuitDialogSelection::Kill => (
            Style::default().fg(Color::White),
            Style::default().fg(Color::Black).bg(Color::Red).bold(),
        ),
    };

    let buttons = Line::from(vec![
        Span::raw("     "),
        Span::styled(" Cancel ", cancel_style),
        Span::raw("     "),
        Span::styled("  Kill  ", kill_style),
        Span::raw("     "),
    ]);

    let dialog = Paragraph::new(vec![
        Line::from(""),
        Line::from(Span::styled(
            "Kill server process?",
            Style::default().fg(Color::Yellow).bold(),
        )),
        Line::from(""),
        buttons,
        Line::from(""),
        Line::from(Span::styled(
            "←/→ select   Enter confirm",
            Style::default().fg(Color::DarkGray),
        )),
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
