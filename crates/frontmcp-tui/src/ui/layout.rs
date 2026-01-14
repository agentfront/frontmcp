//! Main layout component
//!
//! Layout with fixed overview panel on left and tab content on right.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Tabs},
};

use crate::state::{DashboardState, FocusArea, Tab};
use crate::ui::{overview, tabs};

/// Render the main content layout (overview + tab content)
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    // Split into overview (25%) and main content (75%)
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(25), Constraint::Percentage(75)])
        .split(area);

    // Render overview panel (always visible)
    overview::render(frame, chunks[0], state);

    // Render tab content area
    render_tab_area(frame, chunks[1], state);
}

/// Render the tab area (tab bar + content)
fn render_tab_area(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Fill(1)])
        .split(area);

    render_tab_bar(frame, chunks[0], state);
    render_tab_content(frame, chunks[1], state);
}

/// Render the tab bar
fn render_tab_bar(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let titles: Vec<&str> = Tab::all().iter().map(|t| t.name()).collect();

    // Highlight style depends on focus
    let highlight_style = if state.focus == FocusArea::TabBar {
        Style::default().fg(Color::Cyan).bold().underlined()
    } else {
        Style::default().fg(Color::Cyan).bold()
    };

    let tabs = Tabs::new(titles)
        .block(
            Block::default()
                .borders(Borders::BOTTOM)
                .border_style(Style::default().fg(Color::DarkGray)),
        )
        .select(state.active_tab.index())
        .style(Style::default().fg(Color::DarkGray))
        .highlight_style(highlight_style)
        .divider(" │ ");

    frame.render_widget(tabs, area);
}

/// Render the content for the active tab
fn render_tab_content(frame: &mut Frame, area: Rect, state: &DashboardState) {
    match state.active_tab {
        Tab::Sessions => tabs::sessions::render(frame, area, state),
        Tab::Activity => tabs::activity::render(frame, area, state),
        Tab::Logs => tabs::logs::render(frame, area, state),
        Tab::Metrics => tabs::metrics::render(frame, area, state),
        Tab::Playground => tabs::playground::render(frame, area, state),
        Tab::AiInsight => tabs::ai_insight::render(frame, area, state),
    }
}
