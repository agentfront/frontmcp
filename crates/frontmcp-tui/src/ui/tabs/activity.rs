//! Capabilities tab component (formerly Activity)
//!
//! Shows Tools, Resources, Prompts, and Plugins with sub-tabs.

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Tabs, Wrap},
};

use crate::state::{ActivitySubTab, DashboardState, FocusArea, ToolInfo};

/// Render the capabilities tab
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
                ActivitySubTab::Plugins => state.plugins.len(),
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
    let (title, items, list_len): (&str, Vec<ListItem>, usize) = match state.activity_sub_tab {
        ActivitySubTab::Tools => {
            // Group tools by owner app
            let items = render_tools_grouped_by_app(&state.tools);
            ("Tools", items, state.tools.len())
        }
        ActivitySubTab::Resources => {
            let items: Vec<ListItem> = state
                .resources
                .iter()
                .map(|r| {
                    ListItem::new(Line::from(vec![
                        Span::styled("●", Style::default().fg(Color::Blue)),
                        Span::raw(" "),
                        Span::styled(&r.name, Style::default().fg(Color::White)),
                    ]))
                })
                .collect();
            ("Resources", items, state.resources.len())
        }
        ActivitySubTab::Prompts => {
            let items: Vec<ListItem> = state
                .prompts
                .iter()
                .map(|p| {
                    ListItem::new(Line::from(vec![
                        Span::styled("●", Style::default().fg(Color::Magenta)),
                        Span::raw(" "),
                        Span::styled(&p.name, Style::default().fg(Color::White)),
                    ]))
                })
                .collect();
            ("Prompts", items, state.prompts.len())
        }
        ActivitySubTab::Plugins => {
            let items: Vec<ListItem> = state
                .plugins
                .iter()
                .map(|p| {
                    let version = p.version.as_deref().unwrap_or("");
                    ListItem::new(Line::from(vec![
                        Span::styled("●", Style::default().fg(Color::Yellow)),
                        Span::raw(" "),
                        Span::styled(&p.name, Style::default().fg(Color::White)),
                        if !version.is_empty() {
                            Span::styled(format!(" v{}", version), Style::default().fg(Color::DarkGray))
                        } else {
                            Span::raw("")
                        },
                    ]))
                })
                .collect();
            ("Plugins", items, state.plugins.len())
        }
    };

    let border_style = if state.focus == FocusArea::List {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let list = List::new(items)
        .block(
            Block::default()
                .title(format!(" {} ", title))
                .borders(Borders::ALL)
                .border_style(border_style),
        )
        .highlight_style(Style::default().bg(Color::DarkGray).fg(Color::White))
        .highlight_symbol("> ");

    // Create list state for scrolling
    let mut list_state = ListState::default();
    list_state.select(Some(state.list_selected));

    frame.render_stateful_widget(list, area, &mut list_state);

    // Render scrollbar if content exceeds visible area
    let visible_height = area.height.saturating_sub(2) as usize;
    if list_len > visible_height {
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .begin_symbol(Some("▲"))
            .end_symbol(Some("▼"));
        let mut scrollbar_state = ScrollbarState::new(list_len).position(state.list_selected);
        frame.render_stateful_widget(
            scrollbar,
            area.inner(Margin { vertical: 1, horizontal: 0 }),
            &mut scrollbar_state,
        );
    }
}

/// Render tools with owner prefix badges to show grouping visually.
/// This keeps the flat list structure for proper selection while showing ownership.
fn render_tools_grouped_by_app(tools: &[ToolInfo]) -> Vec<ListItem<'static>> {
    tools
        .iter()
        .map(|tool| {
            let (prefix, prefix_color) = match tool.owner_kind.as_deref() {
                Some("app") => {
                    let app_id = tool.owner_id.as_deref().unwrap_or("?");
                    (format!("[{}] ", app_id), Color::Cyan)
                }
                Some("plugin") => {
                    let plugin_id = tool.owner_id.as_deref().unwrap_or("?");
                    (format!("[P:{}] ", plugin_id), Color::Yellow)
                }
                _ => ("".to_string(), Color::DarkGray),
            };

            ListItem::new(Line::from(vec![
                if !prefix.is_empty() {
                    Span::styled(prefix, Style::default().fg(prefix_color))
                } else {
                    Span::raw("")
                },
                Span::styled("●", Style::default().fg(Color::Green)),
                Span::raw(" "),
                Span::styled(tool.name.clone(), Style::default().fg(Color::White)),
            ]))
        })
        .collect()
}

fn render_detail(frame: &mut Frame, area: Rect, state: &DashboardState) {
    let border_style = if state.focus == FocusArea::Detail {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let (content, content_height) = match state.activity_sub_tab {
        ActivitySubTab::Tools => render_tool_detail(state),
        ActivitySubTab::Resources => {
            if let Some(resource) = state.resources.get(state.list_selected) {
                let owner = match (&resource.owner_kind, &resource.owner_id) {
                    (Some(kind), Some(id)) => format!("{kind}:{id}"),
                    _ => "direct".to_string(),
                };
                let uri = resource.uri.as_deref().unwrap_or("N/A");
                (format!(
                    "Resource: {}\n\nURI: {}\nOwner: {}\n\nThis resource is available for MCP clients to read.",
                    resource.name, uri, owner
                ), 8)
            } else {
                ("No resource selected\n\nSelect a resource to view details.".to_string(), 4)
            }
        }
        ActivitySubTab::Prompts => {
            if let Some(prompt) = state.prompts.get(state.list_selected) {
                let owner = match (&prompt.owner_kind, &prompt.owner_id) {
                    (Some(kind), Some(id)) => format!("{kind}:{id}"),
                    _ => "direct".to_string(),
                };
                (format!(
                    "Prompt: {}\n\nOwner: {}\n\nThis prompt is available for MCP clients to use.",
                    prompt.name, owner
                ), 6)
            } else {
                ("No prompt selected\n\nSelect a prompt to view details.".to_string(), 4)
            }
        }
        ActivitySubTab::Plugins => {
            if let Some(plugin) = state.plugins.get(state.list_selected) {
                let version = plugin.version.as_deref().unwrap_or("N/A");
                let owner = plugin.owner_id.as_deref().unwrap_or("direct");
                (format!(
                    "Plugin: {}\n\nVersion: {}\nOwner: {}\n\nThis plugin is active and providing capabilities.",
                    plugin.name, version, owner
                ), 8)
            } else {
                ("No plugin selected\n\nSelect a plugin to view details.".to_string(), 4)
            }
        }
    };

    // Apply scroll offset
    let visible_height = area.height.saturating_sub(2) as usize;
    let scroll_offset = state.detail_scroll.min(content_height.saturating_sub(visible_height));

    let detail = Paragraph::new(content.clone())
        .block(
            Block::default()
                .title(" Details ")
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
}

fn render_tool_detail(state: &DashboardState) -> (String, usize) {
    if let Some(tool) = state.tools.get(state.list_selected) {
        let mut lines = Vec::new();

        // Tool name (header)
        lines.push(format!("Tool: {}", tool.name));
        lines.push(String::new());

        // Description
        if let Some(desc) = &tool.description {
            lines.push("Description:".to_string());
            lines.push(desc.clone());
            lines.push(String::new());
        }

        // Owner
        let owner = match (&tool.owner_kind, &tool.owner_id) {
            (Some(kind), Some(id)) => format!("{kind}:{id}"),
            _ => "direct".to_string(),
        };
        lines.push(format!("Owner: {}", owner));
        lines.push(String::new());

        // Input Schema
        if let Some(schema) = &tool.input_schema {
            lines.push("Input Schema:".to_string());
            // Pretty print JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(schema) {
                if let Ok(pretty) = serde_json::to_string_pretty(&json) {
                    for line in pretty.lines() {
                        lines.push(format!("  {}", line));
                    }
                } else {
                    lines.push(format!("  {}", schema));
                }
            } else {
                lines.push(format!("  {}", schema));
            }
            lines.push(String::new());
        }

        // Output Schema
        if let Some(schema) = &tool.output_schema {
            lines.push("Output Schema:".to_string());
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(schema) {
                if let Ok(pretty) = serde_json::to_string_pretty(&json) {
                    for line in pretty.lines() {
                        lines.push(format!("  {}", line));
                    }
                } else {
                    lines.push(format!("  {}", schema));
                }
            } else {
                lines.push(format!("  {}", schema));
            }
        }

        let content_height = lines.len();
        (lines.join("\n"), content_height)
    } else {
        ("No tool selected\n\nSelect a tool to view details.".to_string(), 4)
    }
}
