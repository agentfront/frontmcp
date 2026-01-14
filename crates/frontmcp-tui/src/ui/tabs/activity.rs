//! Activity tab component
//!
//! Shows Tools, Resources, and Prompts with sub-tabs.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, Paragraph, Tabs, Wrap},
};

use crate::state::{ActivitySubTab, DashboardState, FocusArea};

/// Render the activity tab
pub fn render(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Fill(1)])
        .split(area);

    render_sub_tabs(frame, chunks[0], state);
    render_sub_tab_content(frame, chunks[1], state);
}

fn render_sub_tabs(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let titles: Vec<String> = ActivitySubTab::all()
        .iter()
        .map(|t| {
            let count = match t {
                ActivitySubTab::Tools => state.tools.len(),
                ActivitySubTab::Resources => state.resources.len(),
                ActivitySubTab::Prompts => state.prompts.len(),
            };
            format!("{} ({})", t.name(), count)
        })
        .collect();

    let highlight_style = if state.focus == FocusArea::SubTab {
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
        .select(state.activity_sub_tab.index())
        .style(Style::default().fg(Color::DarkGray))
        .highlight_style(highlight_style)
        .divider(" │ ");

    frame.render_widget(tabs, area);
}

fn render_sub_tab_content(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(area);

    render_list(frame, chunks[0], state);
    render_detail(frame, chunks[1], state);
}

fn render_list(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let (title, items): (&str, Vec<ListItem>) = match state.activity_sub_tab {
        ActivitySubTab::Tools => {
            let items = state
                .tools
                .iter()
                .enumerate()
                .map(|(idx, t)| {
                    let is_selected = idx == state.list_selected && state.focus == FocusArea::List;
                    let style = if is_selected {
                        Style::default().bg(Color::DarkGray).fg(Color::White)
                    } else {
                        Style::default()
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled("●", Style::default().fg(Color::Green)),
                        Span::raw(" "),
                        Span::styled(&t.name, Style::default().fg(Color::White)),
                    ]))
                    .style(style)
                })
                .collect();
            ("Tools", items)
        }
        ActivitySubTab::Resources => {
            let items = state
                .resources
                .iter()
                .enumerate()
                .map(|(idx, r)| {
                    let is_selected = idx == state.list_selected && state.focus == FocusArea::List;
                    let style = if is_selected {
                        Style::default().bg(Color::DarkGray).fg(Color::White)
                    } else {
                        Style::default()
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled("●", Style::default().fg(Color::Blue)),
                        Span::raw(" "),
                        Span::styled(&r.name, Style::default().fg(Color::White)),
                    ]))
                    .style(style)
                })
                .collect();
            ("Resources", items)
        }
        ActivitySubTab::Prompts => {
            let items = state
                .prompts
                .iter()
                .enumerate()
                .map(|(idx, p)| {
                    let is_selected = idx == state.list_selected && state.focus == FocusArea::List;
                    let style = if is_selected {
                        Style::default().bg(Color::DarkGray).fg(Color::White)
                    } else {
                        Style::default()
                    };
                    ListItem::new(Line::from(vec![
                        Span::styled("●", Style::default().fg(Color::Magenta)),
                        Span::raw(" "),
                        Span::styled(&p.name, Style::default().fg(Color::White)),
                    ]))
                    .style(style)
                })
                .collect();
            ("Prompts", items)
        }
    };

    let border_style = if state.focus == FocusArea::List {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let list = List::new(items).block(
        Block::default()
            .title(format!(" {} ", title))
            .borders(Borders::ALL)
            .border_style(border_style),
    );

    frame.render_widget(list, area);
}

fn render_detail(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let border_style = if state.focus == FocusArea::Detail {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let content = match state.activity_sub_tab {
        ActivitySubTab::Tools => {
            if let Some(tool) = state.tools.get(state.list_selected) {
                let owner = match (&tool.owner_kind, &tool.owner_id) {
                    (Some(kind), Some(id)) => format!("{kind}:{id}"),
                    _ => "direct".to_string(),
                };
                format!("Tool: {}\n\nOwner: {}\n\nThis tool is registered and available for MCP clients to call.", tool.name, owner)
            } else {
                "No tool selected\n\nSelect a tool to view details.".to_string()
            }
        }
        ActivitySubTab::Resources => {
            if let Some(resource) = state.resources.get(state.list_selected) {
                let owner = match (&resource.owner_kind, &resource.owner_id) {
                    (Some(kind), Some(id)) => format!("{kind}:{id}"),
                    _ => "direct".to_string(),
                };
                let uri = resource.uri.as_deref().unwrap_or("N/A");
                format!(
                    "Resource: {}\n\nURI: {}\nOwner: {}\n\nThis resource is available for MCP clients to read.",
                    resource.name, uri, owner
                )
            } else {
                "No resource selected\n\nSelect a resource to view details.".to_string()
            }
        }
        ActivitySubTab::Prompts => {
            if let Some(prompt) = state.prompts.get(state.list_selected) {
                let owner = match (&prompt.owner_kind, &prompt.owner_id) {
                    (Some(kind), Some(id)) => format!("{kind}:{id}"),
                    _ => "direct".to_string(),
                };
                format!(
                    "Prompt: {}\n\nOwner: {}\n\nThis prompt is available for MCP clients to use.",
                    prompt.name, owner
                )
            } else {
                "No prompt selected\n\nSelect a prompt to view details.".to_string()
            }
        }
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
